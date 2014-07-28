var test = require('tape').test;
var helper = require('./helper');

var PRIMARY;
var REPLICA;


test('setup', function (t) {
    helper.setup(function (err, pri, repl) {
        t.ifError(err);
        PRIMARY = pri;
        REPLICA = repl;
        t.end();
    });
});

test('teardown', function (t) {
    helper.teardown(function (err) {
        t.ifError(err);
        t.end();
    });
});
