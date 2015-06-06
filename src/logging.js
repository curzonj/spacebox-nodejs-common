'use strict';

var deepMerge = require('./deepMerge.js'),
    uuidGen = require('node-uuid')

function Context(parent) {
    this.prefix = [ ]
    this.limited_prefixes = {}

    if (parent !== undefined) {
      this.extend(parent)
    }
}

var debug_scopes = process.env.MYDEBUG || ''

deepMerge({
    extend: function(parent) {
      this.prefix = parent.prefix.slice()
      Object.keys(parent.limited_prefixes).forEach(function(k) {
        this.limited_prefixes[k] = parent.limited_prefixes[k].slice()
      }, this)
    },
    log: function() {
        var args = Array.prototype.slice.call(arguments),
            name = args.splice(0, 1)[0],
            other = this.limited_prefixes[name] || ''

        console.log.apply(console.log, [ name ].concat(this.prefix, other, args))
    },
    debug: function() {
        var args = Array.prototype.slice.call(arguments),
            name = args.splice(0, 1)[0],
            other = this.limited_prefixes[name] || ''

        if (debug_scopes.indexOf(name) > -1 || debug_scopes.indexOf('*') > -1) 
            console.log.apply(console, [ name ].concat(this.prefix, other, args))
    },
    log_with: function(fn, parts, scope) {
        var ctx = new Context(this)
        if (scope === undefined) {
            ctx.prefix = ctx.prefix.concat(parts)
        } else {
            if (ctx.limited_prefixes[scope] === undefined)
                ctx.limited_prefixes[scope] = []
            ctx.limited_prefixes[scope] = ctx.limited_prefixes[scope].concat(parts)
        }

        return fn(ctx)
    }
}, Context.prototype)

module.exports = Context
