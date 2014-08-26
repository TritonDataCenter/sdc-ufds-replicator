// Copyright (c) 2014, Joyent, Inc. All rights reserved.

var test = require('tape').test;
var vasync = require('vasync');
var once = require('once');
var helper = require('./helper');
var replicator;

// Modify Operation:
// - new/old match query (mod)
// - neither match query (noop)
// - new doesn't match, old does (del)
// - new matches, old doesn't (mod)
// - local missing, new matches (add)
