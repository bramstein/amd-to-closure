// This code borrows heavily from: https://github.com/jaredhanson/deamdify/
var through = require('through'),
    esprima = require('esprima'),
    estraverse = require('estraverse'),
    escodegen = require('escodegen'),
    util = require('util'),
    path = require('path');

module.exports = function (file, options) {
  var data = '',
      stream = through(write, end),
      baseUrl = options && options.baseUrl || '.',
      format = (options && options.format === false) ? false : true;

  return stream;

  function write(buf) {
    data += buf;
  }

  function end() {
    var ast = esprima.parse(data, format ? { range: true, tokens: true, comment: true } : {}),
        isAMD = false,
        tast = null,
        id = pathToNamespace(baseUrl, file);

    estraverse.replace(ast, {
      enter: function (node) {
        if (isDefine(node)) {
          var parents = this.parents();

          if (parents.length === 2 && parents[0].type === 'Program' && parents[1].type === 'ExpressionStatement') {
            isAMD = true;
          }
        }
      },
      leave: function (node) {
        if (isDefine(node)) {
          if (node.arguments.length === 1 &&
              node.arguments[0].type === 'FunctionExpression') {
            // define(function (...) {});
            var factory = node.arguments[0];

            if (factory.params.length === 0) {
              tast = createProgram(id, factory.body.body, ast);
              this.break();
            } else if (factory.params.length > 0) {
              // define(function (require, exports, module) {});
              console.error('define(function (require, exports, module) {...}); is currently not supported.');
              this.break();
            }
          } else if (node.arguments.length === 1 &&
                     node.arguments[0].type === 'ObjectExpression') {
            // define({});
            var obj = node.arguments[0];

            tast = createProgram(id, [createModuleExport(id, obj)], ast);
            this.break();
          } else if (node.arguments.length === 2 &&
                     node.arguments[0].type === 'ArrayExpression' &&
                     node.arguments[1].type === 'FunctionExpression') {
            // define([...], function (...) {});
            var dependencies = node.arguments[0],
                factory = node.arguments[1];
            tast = transformDefinition(baseUrl, id, dependencies, factory, ast);
            this.break();
          } else if (node.arguments.length === 3 &&
                     node.arguments[0].type === 'Literal' &&
                     node.arguments[1].type === 'ArrayExpression' &&
                     node.arguments[2].type === 'FunctionExpression') {
            // define('<id>', [...], function (...) {});
            var identifier = node.arguments[0],
                dependencies = node.arguments[1],
                factory = node.arguments[2];
            console.warn('ignoring manually specified "%s" identifier in "%s"', identifier.value, file);
            tast = transformDefinition(baseUrl, id, dependencies, factory, ast);
            this.break();
          }
        } else if (isReturn(node)) {
          var parents = this.parents();

          if (parents.length === 5 && isDefine(parents[2]) && isAMD) {
            return createModuleExport(id, node.argument);
          }
        }
      }
    });

    if (!isAMD) {
      stream.queue(data);
      stream.queue(null);
      return;
    }

    var tree = tast || ast;

    if (format) {
      escodegen.attachComments(tree, tree.comments, tree.tokens);
      stream.queue(escodegen.generate(tree, {
        comment: true,
        format: {
          indent: {
            adjustMultilineComment: true
          }
        }
      }));
    } else {
      stream.queue(escodegen.generate(tree));
    }
    stream.queue(null);
  }
};

function buildRootIdByName(id, ast) {
  var rootIdByName = {};
  estraverse.traverse(ast, {
    enter: function (node, parent) {
      if (node.type === 'FunctionExpression' ||
          node.type === 'FunctionDeclaration') {
        return estraverse.VisitorOption.Skip;
      }
    },
    leave: function (node, parent) {
      if (node.type === 'VariableDeclarator' ||
          node.type === 'FunctionDeclaration') {
        rootIdByName[node.id.name] = id.concat([node.id.name]);
      }
    }
  });
  return rootIdByName;
}

function namespacedNameFromId(id) {
  var namespace = id.slice(0, id.length - 1);
  var name = id[id.length - 1];
  return namespace.join('$') + name;
}

function transformIdentifier(moduleIdByName, rootIdByName, name) {
  var identifier = null;
  if (moduleIdByName[name]) {
    identifier = createNamespace(moduleIdByName[name]);
  } else if (rootIdByName[name]) {
    identifier = createProperty(namespacedNameFromId(rootIdByName[name]));
  }
  return identifier;
}

function transformDefinition(baseUrl, id, dependencies, factory, ast) {
  var identifiers = dependencies.elements.map(function (el) {
    return pathToNamespace(baseUrl, el.value);
  });

  var moduleIdByName = {};
  factory.params.forEach(function (p, i) {
    moduleIdByName[p.name] = identifiers[i];
  });

  var rootIdByName = buildRootIdByName(id, factory.body);

  estraverse.replace(ast, {
    leave: function (node, parent) {
      var result = null;
      // Correct  : module.x.x  -> $$ns$$module.x.x
      // Incorrect: x.module.x  -> x.$$ns$$module.x
      // Correct  : {x: module} -> {x: $$ns$$module}
      // Incorrect: {module: x} -> {$$ns$$module: x}
      if (node.type === 'Property') {
        // Transform only value identifiers of a Property.
        if (node.value.type === 'Identifier') {
          var name = node.value.name;
          var identifier = transformIdentifier(moduleIdByName, rootIdByName, name);
          if (identifier) {
            node.value = identifier;
            result = node;
          }
        }
      } else if (node.type === 'MemberExpression' && !node.computed) {
        // Transform only the first identifier in a MemberExpression.
        if (node.object.type === 'Identifier') {
          var name = node.object.name;
          var identifier = transformIdentifier(moduleIdByName, rootIdByName, name);
          if (identifier) {
            node.object = identifier;
            result = node;
          }
        }
      } else if (!(parent.type === 'MemberExpression' && !parent.computed)
                 && parent.type !== 'Property'
                 && node.type === 'Identifier') {
        // Transform other identifiers that are not Property/MemberExpression.
        result = transformIdentifier(moduleIdByName, rootIdByName, node.name);
      }
      if (result) {
        return result;
      }
    }
  });

  var requires = identifiers.map(createRequire);
  return createProgram(id, requires.concat(factory.body.body), ast);
}

function pathToNamespace(base, file) {
  // FIXME: Make this more robust
  var p = path.normalize(path.relative(base, file));
  var namespace = path.join(path.dirname(p), path.basename(p, '.js')).replace(/-/g, '_').split(path.sep);
  var moduleName = namespace.pop();
  moduleName += '$$';
  namespace.push(moduleName);
  return namespace;
}

function isDefine(node) {
  var callee = node.callee;

  return callee &&
    node.type === 'CallExpression' &&
    callee.type === 'Identifier' &&
    callee.name === 'define';
}

function isIdentifier(node) {
  return node.type === 'Identifier';
}

function isReturn(node) {
  return node.type == 'ReturnStatement';
}

function createProgram(id, body, tree) {
  body.unshift(createProvide(id));

  var result = {
    type: 'Program',
    body: body
  };

  // This would be nicer if we assumed define(...) is always top level,
  // allowing us to modify the whole program instead of faking a copy.
  if (tree.tokens) {
    result.tokens = tree.tokens;
  }

  if (tree.comments) {
    result.comments = tree.comments;
  }

  if (tree.range) {
    result.range = tree.range;
  }

  return result;
}

function createProvide(id) {
  return {
    type: 'ExpressionStatement',
    expression: {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        computed: false,
        object: createProperty('goog'),
        property: createProperty('provide')
      },
      arguments: [createLiteral(id.join('.'))]
    },
    range: [0, 0]
  };
}

function createRequire(id) {
  return {
    type: 'ExpressionStatement',
    expression: {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        computed: false,
        object: createProperty('goog'),
        property: createProperty('require')
      },
      arguments: [createLiteral(id.join('.'))],
      range: [0, 0]
    },
    range: [0, 0]
  };
}

function createLiteral(value) {
  return {
    type: 'Literal',
    value: value,
    range: [0, 0]
  };
}

function createProperty(name) {
  return {
    type: 'Identifier',
    name: name,
    range: [0, 0]
  };
}

function createNamespace(namespace) {
  var result = null;

  for (var i = 0; i < namespace.length; i += 1) {
    if (result === null) {
      result = createProperty(namespace[i]);
    } else {
      result = {
        type: 'MemberExpression',
        computed: false,
        object: result,
        property: createProperty(namespace[i]),
        range: [0,0]
      };
    }
  }
  return result;
}

function createModuleExport(namespace, obj) {
  return {
    type: 'ExpressionStatement',
    expression: {
      type: 'AssignmentExpression',
      operator: '=',
      left: createNamespace(namespace),
      right: obj
    },
    range: [0, 0]
  };
}
