var measured = require('measured'),
    stats = measured.createCollection()

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
        if (self[name] !== undefined)
            throw new Error(name +' is already defined in stats')

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


process.nextTick(function() {
    var lastRun, logger

    // This fixes the circular dependency between stats and logging
    logging = require('./logging')

    setInterval(function() {
        var values = { stats: stats }

        // defer creating the logger until someone
        // configures it
        if (!logger)
            logger = logging.create()

        if (lastRun) {
            var thisRun = Date.now()
            values.jitter  = thisRun - lastRun - 1000
            lastRun = thisRun
        } else {
            lastRun = Date.now()
        }

        if (process && process.memoryUsage)
            values.memory = process.memoryUsage()

        // TODO we need other ways of delivering
        // metrics
        logger.debug(values, 'metrics')
    }, 1000)
})
