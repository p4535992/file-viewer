import * as peer from 'svelte'
import * as stores from 'svelte/store'

export const propNames = [
  'url',
  'file',
  'buffer',
  'name',
  'filename',
  'type',
  'size',
  'options',
  'onEvent',
  'onStateChange',
  'className',
  'containerStyle'
]
const viewerNames = propNames.slice(0, 10)
const initialProps = (props) =>
  Object.fromEntries(
    propNames.map((name) => [
      name,
      props[name] === undefined && ['className', 'containerStyle'].includes(name) ? '' : props[name]
    ])
  )
const unequal = (a, b) =>
  a !== a ? b === b : a !== b || Boolean(a && typeof a === 'object') || typeof a === 'function'
const dispatch = (callbacks, event, receiver) => {
  for (const callback of Array.isArray(callbacks) ? [...callbacks] : callbacks ? [callbacks] : [])
    callback.call(receiver, event)
}
const escapeAttribute = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
const html = (props) =>
  `<div class="${escapeAttribute(props.className)}" style="width: 100%; height: 100%; min-height: 0; ${escapeAttribute(props.containerStyle)}"></div>`

export function createRuntimeComponent({
  createHandle,
  mountViewer,
  coreOptions,
  transformOptions = (value) => value,
  transformMountOptions = (value) => value
}) {
  class Legacy {
    constructor(options = {}) {
      this.props = initialProps(options.props || {})
      this.controller = null
      this.element = null
      this.alive = true
      const dispose = () => {
        this.controller?.destroy()
        this.controller = null
      }
      const handle = createHandle(() => this.controller, dispose)
      this.methods = Object.keys(handle)
      for (const method of this.methods)
        this[method] = (...args) =>
          handle[method](
            ...(['load', 'update'].includes(method) ? [transformMountOptions(args[0])] : args)
          )
      let context = options.context
      if (!context) {
        try {
          context = Reflect.get(peer, 'getAllContexts')?.()
        } catch {
          /* A standalone constructor has no parent component context. */
        }
      }
      this.$$ = {
        ctx: [
          ...propNames.map((name) => this.props[name]),
          ...this.methods.map((name) => this[name])
        ],
        props: Object.fromEntries(
          [...propNames, ...this.methods].map((name, index) => [name, index])
        ),
        update: () => {},
        not_equal: unequal,
        bound: {},
        callbacks: { ...options.props?.$$events },
        on_mount: [
          () => {
            if (this.alive) this.mount()
            return dispose
          }
        ],
        on_destroy: [
          () => {
            this.alive = false
            dispose()
          }
        ],
        on_disconnect: [],
        before_update: [],
        after_update: [],
        context: context || new Map(),
        dirty: [-1],
        skip_bound: false,
        root: options.target || null
      }
      this.$$.fragment = {
        c: () => {
          this.element = document.createElement('div')
          this.style()
        },
        l: (nodes) => {
          nodes.claim_info ||= { last_index: 0, total_claimed: 0 }
          const index = nodes.findIndex((node) => node.nodeType === 1 && node.tagName === 'DIV')
          if (index >= 0) this.element = nodes.splice(index, 1)[0]
          else this.$$.fragment.c()
          this.element.claim_order = nodes.claim_info.total_claimed++
          if (index >= 0) nodes.claim_info.last_index = index
          this.claimed = true
          this.style()
        },
        m: (target, anchor) => {
          if (!(this.claimed && this.element.parentNode === target))
            target.insertBefore(this.element, anchor || null)
          if (this.claimed && target.actual_end_child === this.element)
            target.actual_end_child = this.element.nextSibling
          this.claimed = false
        },
        p: () => {},
        i: () => {},
        o: () => {},
        d: (detach) => {
          if (detach) this.element?.remove()
        }
      }
      if (options.target) {
        if (options.hydrate) this.$$.fragment.l(Array.from(options.target.childNodes))
        else this.$$.fragment.c()
        this.$$.fragment.m(options.target, options.anchor)
        Promise.resolve(Reflect.get(peer, 'tick')()).then(() => {
          if (this.alive) this.mount()
        })
      }
    }
    style() {
      if (!this.element) return
      this.element.setAttribute('class', this.props.className ?? '')
      this.element.setAttribute(
        'style',
        `width: 100%; height: 100%; min-height: 0; ${this.props.containerStyle ?? ''}`
      )
    }
    viewerOptions() {
      const value = Object.fromEntries(viewerNames.map((name) => [name, this.props[name]]))
      value.options = transformOptions(value.options)
      value.onEvent = (event) => {
        this.props.onEvent?.(event)
        dispatch(
          this.$$.callbacks.viewerEvent,
          new CustomEvent('viewerEvent', { detail: event }),
          this
        )
      }
      value.onStateChange = (...args) => this.props.onStateChange?.(...args)
      return value
    }
    mount() {
      if (!this.controller && this.alive)
        this.controller = mountViewer(this.element, this.viewerOptions(), coreOptions)
    }
    $set(next) {
      if (!this.alive) return
      const changes = {}
      for (const name of propNames) {
        if (!(name in next)) continue
        const value =
          next[name] === undefined && ['className', 'containerStyle'].includes(name)
            ? ''
            : next[name]
        if (
          viewerNames.includes(name) &&
          !['onEvent', 'onStateChange'].includes(name) &&
          unequal(this.props[name], value)
        ) {
          changes[name] = name === 'options' ? transformOptions(value) : value
        }
        this.props[name] = value
        this.$$.ctx[this.$$.props[name]] = value
      }
      if ('$$events' in next) this.$$.callbacks = { ...next.$$events }
      this.style()
      if (Object.keys(changes).length && this.controller) void this.controller.update(changes)
    }
    $on(type, callback) {
      const callbacks = this.$$.callbacks[type] || (this.$$.callbacks[type] = [])
      if (!Array.isArray(callbacks)) this.$$.callbacks[type] = [callbacks]
      const list = this.$$.callbacks[type]
      list.push(callback)
      return () => {
        const index = list.indexOf(callback)
        if (index >= 0) list.splice(index, 1)
      }
    }
    $destroy() {
      if (!this.alive) return
      for (const callback of this.$$.on_destroy) callback()
      this.$$.fragment?.d(1)
      this.$$.fragment = null
      this.$$.ctx = []
    }
  }
  const base = Reflect.get(peer, 'SvelteComponent')
  if (base?.prototype) Object.setPrototypeOf(Legacy.prototype, base.prototype)
  function Component(anchor, props) {
    if (new.target) return new Legacy(anchor)
    const snippet = Reflect.get(peer, 'createRawSnippet'),
      toStore = Reflect.get(stores, 'toStore')
    if (typeof snippet !== 'function' || typeof toStore !== 'function')
      throw new Error('Use this peer runtime component constructor')
    const instance = new Legacy({
      props,
      context: (() => {
        try {
          return Reflect.get(peer, 'getAllContexts')()
        } catch {
          return new Map()
        }
      })()
    })
    snippet(() => ({
      render: () => html(instance.props),
      setup: (element) => {
        instance.element = element
        let previous
        const stop = toStore(() => ({
          ...Object.fromEntries(propNames.map((name) => [name, props[name]])),
          $$events: props.$$events
        })).subscribe((next) => {
          const changes = previous
            ? Object.fromEntries(
                Object.entries(next).filter(([name, value]) => previous[name] !== value)
              )
            : next
          previous = next
          instance.$set(changes)
        })
        // Snippet setup can run in an inert parent template before insertion.
        // The peer's public tick waits until the actual target document owns it.
        Promise.resolve(Reflect.get(peer, 'tick')()).then(() => {
          if (instance.alive) instance.mount()
        })
        return () => {
          stop()
          instance.$destroy()
        }
      }
    }))(anchor)
    return Object.fromEntries(instance.methods.map((name) => [name, instance[name]]))
  }
  Component.prototype = Legacy.prototype
  Component.$$render = (_result, props) => html(initialProps(props))
  Component.render = (props) => ({
    html: html(initialProps(props || {})),
    head: '',
    css: { code: '', map: null }
  })
  return Component
}

export function createServerRuntimeComponent() {
  function Component(renderer, props) {
    const snippet = Reflect.get(peer, 'createRawSnippet')
    if (typeof snippet !== 'function') throw new Error('Use this peer runtime SSR render interface')
    snippet(() => ({ render: () => html(initialProps(props)) }))(renderer)
  }
  Component.$$render = (_result, props) => html(initialProps(props))
  Component.render = (props) => ({
    html: html(initialProps(props || {})),
    head: '',
    css: { code: '', map: null }
  })
  return Component
}
