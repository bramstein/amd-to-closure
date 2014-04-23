var expect = require('expect.js'),
    transform = require('../index'),
    es = require('event-stream');

function tr(id, str, options, callback) {
  if (!callback) {
    callback = options;
  }
  var transformStream = transform(id, {
        format: false,
        namespace: options && options.namespace || '',
        foreignLibs: options && options.foreignLibs
      }),
      inputStream = es.readArray([str]),
      outputStream = es.writeArray(function (err, array) {
        callback(err, array[0]);
      });

  inputStream.pipe(transformStream);
  transformStream.pipe(outputStream);
}


describe('Convert AMD to Closure Compiler syntax', function () {
  it('transforms a factory method', function (done) {
    tr('ns', 'define(function () { return "foo"; });', function (err, data) {
      expect(data).to.eql("goog.provide('ns$$');\nns$$ = 'foo';");
      done(err);
    });
  });

  it('transforms a factory with a nested namespace', function (done) {
    tr('ns/bs', 'define(function () { return "foo"; });', function (err, data) {
      expect(data).to.eql("goog.provide('ns.bs$$');\nns.bs$$ = 'foo';");
      done(err);
    });
  });

  it('transforms a factory method with dependencies', function (done) {
    tr('ns', 'define(["bs", "as"], function (bs, as) { return bs + as; });', function (err, data) {
      expect(data).to.eql("goog.provide('ns$$');\ngoog.require('bs$$');\ngoog.require('as$$');\nns$$ = bs$$ + as$$;");
      done(err);
    });
  });

  it('transforms a factory method with dependencies and correctly renames dependency identifiers', function (done) {
    tr('ns', 'define(["bs", "as"], function (bsLocal, asLocal) { return bsLocal + asLocal; });', function (err, data) {
      expect(data).to.eql("goog.provide('ns$$');\ngoog.require('bs$$');\ngoog.require('as$$');\nns$$ = bs$$ + as$$;");
      done(err);
    });
  });

  it('transforms a factory method with dependencies and correctly renames nested dependency identifiers', function (done) {
    tr('ns', 'define(["bs/sb", "as/sa"], function (sb, sa) { return sb + sa; });', function (err, data) {
      expect(data).to.eql("goog.provide('ns$$');\ngoog.require('bs.sb$$');\ngoog.require('as.sa$$');\nns$$ = bs.sb$$ + as.sa$$;");
      done(err);
    });
  });

  it('transforms a factory method with identifier, dependencies', function (done) {
    tr('ns', 'define("ons", ["bs"], function (bs) { return bs; });', function (err, data) {
      expect(data).to.eql("goog.provide('ns$$');\ngoog.require('bs$$');\nns$$ = bs$$;");
      done(err);
    });
  });

  it('transforms an object passed to define', function (done) {
    tr('ns', 'define({ hello: "world" });', function (err, data) {
      expect(data).to.eql("goog.provide('ns$$');\nns$$ = { hello: 'world' };");
      done(err);
    });
  });

  it('transforms a factory with global namespace option', function (done) {
    tr('ns', 'define(["bs", "as"], function (bs, as) { return bs + as; });',
      {namespace: 'gns'}, function (err, data) {
      expect(data).to.eql("goog.provide('gns.ns$$');\ngoog.require('gns.bs$$');\ngoog.require('gns.as$$');\ngns.ns$$ = gns.bs$$ + gns.as$$;");
      done(err);
    });
  });

  it('transforms a factory with foreign lib', function (done) {
    tr('ns/bs', 'define(["fl/as"], function (bs) { return bs; });',
      {foreignLibs: ['fl']}, function (err, data) {
      expect(data).to.eql("goog.provide('ns.bs$$');\ngoog.require('fl.as$$');\nns.bs$$ = fl.as$$;");
      done(err);
    });
  });

  it('transforms a factory with foreign lib and global namespace', function (done) {
    tr('ns/bs', 'define(["fl/as"], function (bs) { return bs; });',
      {namespace: 'gns', foreignLibs: ['fl']}, function (err, data) {
      expect(data).to.eql("goog.provide('gns.ns.bs$$');\ngoog.require('fl.as$$');\ngns.ns.bs$$ = fl.as$$;");
      done(err);
    });
  });
});
