<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# UFDS Replicator

Repository: <git@git.joyent.com:eng.git>
Browsing: <https://mo.joyent.com/eng>
Who: Patrick Mooney
Tickets/bugs: <https://devhub.joyent.com/jira/browse/CAPI>


# Overview

UFDS Replicator is the service used for selectively replicating collections of
objects from one or more master UFDS instances to a local replica instance.


# Development

To run the boilerplate API server:

    git clone git@git.joyent.com:ufds-replicator.git
    cd ufds-replicator
    git submodule update --init
    make all
    node replicator.js

To update the guidelines, edit "docs/index.restdown" and run `make docs`
to update "docs/index.html".

Before commiting/pushing run `make prepush` and, if possible, get a code
review.



# Testing

    make test

If you project has setup steps necessary for testing, then describe those
here.
