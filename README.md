## Transform AMD modules to Closure Compiler dependency syntax

This an experimental code transform that takes AMD modules and outputs Closure Compiler compatible code. This lets you write AMD code in development and still have the benefits of Closure Compiler's optimizations. Unfortunately Closure Compiler's native support for AMD modules is lacking and has some unfortunate side-effects so transforming modules is the way to go for now.

## Installation

    $ npm install amd-to-closure -g

## Usage

    $ amd-to-closure <baseUrl> <file>

## AMD compatibility

The transformer supports most of the AMD specification, but not the CommonJS-like syntax. The following AMD module:

    // component.js
    define(['core/dom', 'util/template', function (dom, template) {
      ...
      return dom.expand(template);
    });

Transforms to:

    goog.provide('component');

    goog.require('core.dom');
    goog.require('util.template');

    ...

    component = core.dom.expand(util.template);

Note that the parameters to the define function are correctly rewritten to their Closure Compiler dependency syntax equivalent.

## License

Licensed under the three-clause BSD license.
