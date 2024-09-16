const http = require('http')
const Prometheus = require('prom-client')

const VALID_PROMETHEUS_LABEL_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'

module.exports = class HypertracePrometheus {
  constructor ({ port, register = null, collectDefaults = true }) {
    this.register = register || new Prometheus.Registry()

    if (collectDefaults) {
      Prometheus.collectDefaultMetrics({ register: this.register })
    }

    if (port) {
      this.server = http.createServer(async (req, res) => {
        const isMetricsEndpoint = req.url === '/metrics'
        if (!isMetricsEndpoint) return res.end()

        res.setHeader('Content-Type', this.register.contentType)
        const metrics = await this.register.metrics()
        res.end(metrics)
      })
      this.server.listen(port)
    }
  }

  async stop () {
    if (this.traceCounter) this.register.removeSingleMetric(this.traceCounter.name)
    if (this.timerCounter) this.register.removeSingleMetric(this.timerCounter.name)
    if (this.memoryInstanceLifetimeGauge) this.register.removeSingleMetric(this.memoryInstanceLifetimeGauge.name)
    if (this.server) return new Promise(resolve => this.server.close(resolve))
  }

  async metrics () {
    return await this.register.metrics()
  }

  createTraceFunction ({ allowedProps = [] } = { }) {
    const labelNames = [
      'id',
      'object_classname',
      'object_id',
      'parent_object_classname',
      'parent_object_id',
      'caller_functionname',
      'caller_filename'
    ]
    allowedProps?.forEach(name => {
      const cleanedName = strToValidPrometheusLabel(name)
      labelNames.push(`object_props_${cleanedName}`)
      labelNames.push(`parent_object_props_${cleanedName}`)
      labelNames.push(`caller_props_${cleanedName}`)
    })

    this.traceCounter = new Prometheus.Counter({
      name: 'trace_counter',
      help: 'Counts how many times a function has been traced',
      labelNames
    })
    this.register.registerMetric(this.traceCounter)

    return ({ id, object, parentObject, caller }) => {
      const labels = {
        object_classname: object.className,
        object_id: object.id,
        caller_functionname: caller.functionName,
        caller_filename: caller.filename
      }
      if (id) labels.id = id
      if (parentObject?.className) labels.parent_object_classname = parentObject.className
      if (parentObject?.id) labels.parent_object_id = parentObject.id
      allowedProps?.forEach(name => {
        const cleanedName = strToValidPrometheusLabel(name)
        const objectValue = object.props?.[name]
        const parentObjectValue = parentObject?.props?.[name]
        const callerValue = caller.props?.[name]
        if (objectValue !== undefined) labels[`object_props_${cleanedName}`] = objectValue
        if (parentObjectValue !== undefined) labels[`parent_object_props_${cleanedName}`] = parentObjectValue
        if (callerValue !== undefined) labels[`caller_props_${cleanedName}`] = callerValue
      })
      this.traceCounter.inc(labels)
    }
  }

  createMemoryFunction ({ allowedProps = [] } = {}) {
    const labelNames = [
      'object_classname',
      'object_id',
      'parent_object_classname',
      'parent_object_id'
    ]
    allowedProps?.forEach(name => {
      const cleanedName = strToValidPrometheusLabel(name)
      labelNames.push(`object_props_${cleanedName}`)
      labelNames.push(`parent_object_props_${cleanedName}`)
    })

    this.memoryInstanceLifetimeGauge = new Prometheus.Gauge({
      name: 'memory_instance_lifetime_gauge',
      help: 'Gauge that is set to 1 when an instance if alive, and 0 when  it is garbage collected',
      labelNames
    })
    this.register.registerMetric(this.memoryInstanceLifetimeGauge)

    return ({ type, instanceCount, object, parentObject }) => {
      const labelsInstanceLifetime = {
        object_classname: object.className,
        object_id: object.id
      }
      if (parentObject?.className) {
        labelsInstanceLifetime.parent_object_classname = parentObject.className
        labelsInstanceLifetime.parent_object_id = parentObject.id
      }

      allowedProps?.forEach(name => {
        const cleanedName = strToValidPrometheusLabel(name)
        const objectValue = object.props?.[name]
        const parentObjectValue = parentObject?.props?.[name]
        if (objectValue !== undefined) labelsInstanceLifetime[`object_props_${cleanedName}`] = objectValue
        if (parentObjectValue !== undefined) labelsInstanceLifetime[`parent_object_props_${cleanedName}`] = parentObjectValue
      })

      if (type === 'alloc') {
        this.memoryInstanceLifetimeGauge.inc(labelsInstanceLifetime)
      } else {
        this.memoryInstanceLifetimeGauge.dec(labelsInstanceLifetime)
      }
    }
  }

  createTimerFunction () {
    this.timerCounter = new Prometheus.Counter({
      name: 'timer_counter',
      help: 'Counter that shows the execution times of timers',
      labelNames: ['name']
    })
    this.register.registerMetric(this.timerCounter)

    return (name, ms) => {
      this.timerCounter.inc({ name }, ms)
    }
  }
}

function strToValidPrometheusLabel (str) {
  return str
    .split('')
    .map(c => VALID_PROMETHEUS_LABEL_CHARACTERS.includes(c) ? c : '_')
    .join('')
}
