const test = require('brittle')
const HypertracePrometheus = require('../')
const SomeModule = require('./SomeModule.js')
const axios = require('axios')
const Hypertrace = require('hypertrace')

let tf

function teardown () {
  tf?.stop()
  Hypertrace.clearTraceFunction()
}

test('Creates http server with /metrics endpoint', async t => {
  t.teardown(teardown)
  t.plan(1)

  tf = HypertracePrometheus({ port: 4343 })
  const { data } = await axios.get('http://localhost:4343/metrics')
  t.ok(data.includes('# HELP trace_counter Counts how many times a function has been traced'))
})

test('Calling stop() stops http server', async t => {
  t.teardown(teardown)
  t.plan(2)

  tf = HypertracePrometheus({ port: 4343 })
  const { status } = await axios.get('http://localhost:4343/metrics')
  t.is(status, 200)

  tf.stop()
  t.exception(async () => {
    await axios.get('http://localhost:4343/metrics', { timeout: 1000 })
  })
})

test('Setting collectDefaults = true adds default metrics', async t => {
  t.teardown(teardown)
  t.plan(1)

  tf = HypertracePrometheus({ port: 4343, collectDefaults: true })
  const { data } = await axios.get('http://localhost:4343/metrics')
  t.ok(data.includes('process_cpu_user_seconds_total'))
})

test('Setting collectDefaults = false does not add default metrics', async t => {
  t.teardown(teardown)
  t.plan(2)

  tf = HypertracePrometheus({ port: 4343, collectDefaults: false })
  const { data } = await axios.get('http://localhost:4343/metrics')
  t.absent(data.includes('process_cpu_user_seconds_total'))
  t.is(data.split('\n').length, 3)
})

test('Labels are set for trace_counter', async t => {
  t.teardown(teardown)
  t.plan(5)

  tf = HypertracePrometheus({ port: 4343, collectDefaults: true })
  Hypertrace.setTraceFunction(tf)

  const someModule = new SomeModule()
  someModule.foo()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, typeStr, counterStr] = data.split('\n')
  t.is(typeStr, '# TYPE trace_counter counter')
  t.ok(counterStr.includes('caller_classname="SomeModule"'))
  t.ok(counterStr.includes('caller_object_id="'))
  t.ok(counterStr.includes('caller_functionname="foo"'))
  t.ok(counterStr.includes('caller_filename="/test/SomeModule.js"'))
})

test('Counter is set for trace_counter', async t => {
  t.teardown(teardown)
  t.plan(2)

  tf = HypertracePrometheus({ port: 4343, collectDefaults: true })
  Hypertrace.setTraceFunction(tf)

  const someModule = new SomeModule()

  someModule.foo()

  const { data: data1 } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr1] = data1.split('\n')
  t.is(counterStr1[counterStr1.length - 1], '1')

  someModule.foo()

  const { data: data2 } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr2] = data2.split('\n')
  t.is(counterStr2[counterStr2.length - 1], '2')
})

test('Collect custom properties', async t => {
  t.teardown(teardown)
  t.plan(1)

  tf = HypertracePrometheus({
    port: 4343,
    allowedCustomProperties: ['bar'],
    collectDefaults: false
  })
  Hypertrace.setTraceFunction(tf)

  const customProperties = {
    bar: 'bleh'
  }
  const someModule = new SomeModule(customProperties)
  someModule.foo()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('bar="bleh"'))
})

test('Setting non-allowed custom properties means they are not captured', async t => {
  t.teardown(teardown)
  t.plan(2)

  tf = HypertracePrometheus({
    port: 4343,
    allowedCustomProperties: ['someAllowedProperty'],
    collectDefaults: false
  })
  Hypertrace.setTraceFunction(tf)

  const customProperties = {
    someAllowedProperty: 'foo',
    someNonallowedProperty: 'bar'
  }
  const someModule = new SomeModule(customProperties)
  someModule.foo()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('someAllowedProperty'))
  t.absent(counterStr.includes('someNonallowedProperty'))
})

test('Collecting custom properties with illegal label characters, changes the char to underscore', async t => {
  t.teardown(teardown)
  t.plan(2)

  tf = HypertracePrometheus({
    port: 4343,
    allowedCustomProperties: ['foo-bar'],
    collectDefaults: false
  })
  Hypertrace.setTraceFunction(tf)

  const customProperties = {
    'foo-bar': 'foo'
  }
  const someModule = new SomeModule(customProperties)
  someModule.foo()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('foo_bar'))
  t.absent(counterStr.includes('foo-bar'))
})
