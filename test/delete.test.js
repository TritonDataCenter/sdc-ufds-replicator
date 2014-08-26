// Copyright (c) 2014, Joyent, Inc. All rights reserved.

var test = require('tape').test;
var vasync = require('vasync');
var once = require('once');
var helper = require('./helper');
var replicator;


// Delete Operation:
// - simple
// - simple non-matching
// - missing
// - child objects
