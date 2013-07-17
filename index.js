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

            var identifiers = dependencies.elements.map(function (el) {
              return pathToNamespace(baseUrl, el.value);
            });

            var params = factory.params.map(function (p) {
              return p.name;
            });

            var requires = identifiers.map(function (id) {
              return createRequire(id);
            });

            estraverse.replace(ast, {
              leave: function (node) {
                if (isIdentifier(node)) {
                  for (var i = 0; i < params.length; i += 1) {
                    if (node.name === params[i]) {
                      return createNamespace(identifiers[i]);
                    }
                  }
                }
              }
            });

            tast = createProgram(id, requires.concat(factory.body.body), ast);
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

            var identifiers = dependencies.elements.map(function (el) {
              return pathToNamespace(baseUrl, el.value);
            });

            var params = factory.params.map(function (p) {
              return p.name;
            });

            var requires = identifiers.map(function (id) {
              return createRequire(id);
            });

            estraverse.replace(ast, {
              leave: function (node) {
                if (isIdentifier(node)) {
                  for (var i = 0; i < params.length; i += 1) {
                    if (node.name === params[i]) {
                      return createNamespace(identifiers[i]);
                    }
                  }
                }
              }
            });

            tast = createProgram(id, requires.concat(factory.body.body), ast);
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

function pathToNamespace(base, file) {
  // FIXME: Make this more robust
  var p = path.normalize(path.relative(base, file));
  return path.join(path.dirname(p), path.basename(p, '.js')).replace(/-/g, '_').split(path.sep);
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
