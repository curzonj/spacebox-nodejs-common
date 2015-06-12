var measured = require('measured'),
    stats = measured.createCollection(),
    logging = require('./logging')

var logger

var self = module.exports = {
    stats: stats,
    eachStat: function(fn) {
        Object.keys(self).forEach(function(k) {
            var o = self[k]
            if (typeof o.reset === 'function')
                fn(k, o)
        })
    },
    reset: function() {
        self.eachStat(function(name, o) {
            o.reset()
        })
    },
    define: function(name, type, fn) {
        // fn may be undefined, that's ok
        try {
            self[name] = self.stats[type].call(stats, name, fn)
        } catch(e) {
            console.log(name, type, fn)
            console.log(e)

            throw e
        }
    },
    defineAll: function(set) {
        for(var n in set) {
            self.define(n, set[n])
        }
    }
}

setInterval(function() {
    // defer creating the logger until someone
    // configures it
    if (logger === undefined)
        logger = logging.create()

    logger.debug({ metrics: stats }, 'metrics')
}, 1000)
