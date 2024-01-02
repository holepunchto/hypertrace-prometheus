const http = require('http')
const Prometheus = require('prom-client')

const VALID_PROMETHEUS_LABEL_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'

module.exports = ({ port, register = null, allowedProps = [], collectDefaults = true }) => {
  let server
  register = register || new Prometheus.Registry()

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

  const traceCounter = new Prometheus.Counter({
    name: 'trace_counter',
    help: 'Counts how many times a function has been traced',
    labelNames
  })
  register.registerMetric(traceCounter)

  if (collectDefaults) {
    Prometheus.collectDefaultMetrics({ register })
  }

  if (port) {
    server = http.createServer(async (req, res) => {
      const isMetricsEndpoint = req.url === '/metrics'
      if (!isMetricsEndpoint) return res.end()

      res.setHeader('Content-Type', register.contentType)
      const metrics = await register.metrics()
      res.end(metrics)
    })
    server.listen(port)
  }

  function traceFunction ({ id, object, parentObject, caller }) {
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
    traceCounter.inc(labels)
  }

  traceFunction.stop = async () => {
    register.removeSingleMetric(traceCounter.name)
    if (server) return new Promise(resolve => server.close(resolve))
  }

  traceFunction.metrics = () => register.metrics()

  return traceFunction
}

function strToValidPrometheusLabel (str) {
  return str
    .split('')
    .map(c => VALID_PROMETHEUS_LABEL_CHARACTERS.includes(c) ? c : '_')
    .join('')
}
