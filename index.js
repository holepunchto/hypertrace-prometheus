const http = require('http')
const Prometheus = require('prom-client')

const VALID_PROMETHEUS_LABEL_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'

module.exports = ({ port, allowedCustomProperties = [], collectDefaults = true }) => {
  const register = new Prometheus.Registry()

  const cleanedAllowedCustomProperties = allowedCustomProperties?.map(name => strToValidPrometheusLabel(name))
  const labelNames = [
    'object_classname',
    'object_id',
    'parent_object_classname',
    'parent_object_id',
    'caller_functionname',
    'caller_filename'
  ].concat(cleanedAllowedCustomProperties)

  const traceCounter = new Prometheus.Counter({
    name: 'trace_counter',
    help: 'Counts how many times a function has been traced',
    labelNames
  })
  register.registerMetric(traceCounter)

  if (collectDefaults) {
    Prometheus.collectDefaultMetrics({ register })
  }

  const server = http.createServer(async (req, res) => {
    const isMetricsEndpoint = req.url === '/metrics'
    if (!isMetricsEndpoint) return res.end()

    res.setHeader('Content-Type', register.contentType)
    const metrics = await register.metrics()
    res.end(metrics)
  })
  server.listen(port)

  function traceFunction ({ object, parentObject, caller, customProperties }) {
    const labels = {
      object_classname: object.className,
      object_id: object.id,
      caller_functionname: caller.functionName,
      caller_filename: caller.filename
    }
    if (parentObject?.className) labels.parent_object_classname = parentObject.className
    if (parentObject?.id) labels.parent_object_id = parentObject.id
    allowedCustomProperties?.forEach(name => {
      const value = customProperties[name]
      if (value !== undefined) {
        const cleanedName = strToValidPrometheusLabel(name)
        labels[cleanedName] = value
      }
    })
    traceCounter.inc(labels)
  }

  traceFunction.stop = () => {
    Prometheus.register.clear()
    server.close()
  }

  return traceFunction
}

function strToValidPrometheusLabel (str) {
  return str
    .split('')
    .map(c => VALID_PROMETHEUS_LABEL_CHARACTERS.includes(c) ? c : '_')
    .join('')
}
