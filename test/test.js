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
  t.ok(counterStr.includes('object_classname="SomeModule"'))
  t.ok(counterStr.includes('object_id="'))
  t.ok(counterStr.includes('caller_functionname="foo"'))
  t.ok(counterStr.includes('caller_filename="/test/SomeModule.js"'))
})

test('parentObject properties are not set if no parent tracer is set', async t => {
  t.teardown(teardown)
  t.plan(1)

  tf = HypertracePrometheus({ port: 4343, collectDefaults: true })
  Hypertrace.setTraceFunction(tf)

  const someModule = new SomeModule()
  someModule.foo()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.absent(counterStr.includes('parent_object'))
})

test('parentObject is set if parent tracer is set', async t => {
  t.teardown(teardown)
  t.plan(4)

  tf = HypertracePrometheus({ port: 4343, collectDefaults: true })
  Hypertrace.setTraceFunction(tf)

  class Parent {
    constructor () {
      this.tracer = new Hypertrace(this)
    }

    createChild () {
      return new Child(this.tracer)
    }
  }

  class Child {
    constructor (parenTracer) {
      this.tracer = new Hypertrace(this, { parent: parenTracer })
    }

    foo () {
      this.tracer.trace()
    }
  }

  const parent = new Parent()
  const child = parent.createChild()
  child.foo()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('object_classname="Child'))
  t.ok(counterStr.includes('object_id="1"'))
  t.ok(counterStr.includes('parent_object_classname="Parent'))
  t.ok(counterStr.includes('parent_object_id="1"'))
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

test('Collect props passed to caller', async t => {
  t.teardown(teardown)
  t.plan(1)

  tf = HypertracePrometheus({
    port: 4343,
    allowedProps: ['baz'],
    collectDefaults: false
  })
  Hypertrace.setTraceFunction(tf)

  const someProps = {
    baz: 42
  }
  const someModule = new SomeModule()
  someModule.foo(someProps)

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('caller_props_baz="42"'))
})

test('Collect props passed at initiation as object_props_[name]', async t => {
  t.teardown(teardown)
  t.plan(1)

  tf = HypertracePrometheus({
    port: 4343,
    allowedProps: ['foo'],
    collectDefaults: false
  })
  Hypertrace.setTraceFunction(tf)

  const someProps = {
    foo: 'bleh'
  }
  const someModule = new SomeModule(someProps)
  someModule.foo()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('object_props_foo="bleh"'))
})

test('Collect props passed to parents initiations', async t => {
  t.teardown(teardown)
  t.plan(1)

  tf = HypertracePrometheus({
    port: 4343,
    allowedProps: ['foo'],
    collectDefaults: false
  })
  Hypertrace.setTraceFunction(tf)

  const someProps = {
    foo: 'bar'
  }

  class Parent {
    constructor () {
      this.tracer = new Hypertrace(this, { props: someProps })
    }

    createChild () {
      return new Child(this.tracer)
    }
  }

  class Child {
    constructor (parentTracer) {
      this.tracer = new Hypertrace(this, { parent: parentTracer })
    }

    foo () {
      this.tracer.trace()
    }
  }

  const parent = new Parent()
  const child = parent.createChild()
  child.foo()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('parent_object_props_foo="bar"'))
})

test('Setting non-allowed custom properties means they are not captured', async t => {
  t.teardown(teardown)
  t.plan(2)

  tf = HypertracePrometheus({
    port: 4343,
    allowedProps: ['someAllowedProperty'],
    collectDefaults: false
  })
  Hypertrace.setTraceFunction(tf)

  const props = {
    someAllowedProperty: 'foo',
    someNonallowedProperty: 'bar'
  }
  const someModule = new SomeModule(props)
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
    allowedProps: ['foo-bar'],
    collectDefaults: false
  })
  Hypertrace.setTraceFunction(tf)

  const someProps = {
    'foo-bar': 'foo'
  }
  const someModule = new SomeModule(someProps)
  someModule.foo()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('foo_bar'))
  t.absent(counterStr.includes('foo-bar'))
})
