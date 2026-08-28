"use strict";

function createEngine({
  data = null,
  constants = {},
  indexes = {},
  core = {},
  adapters = {},
  systems = {},
  systemFactories = {},
  stateFactories = [],
  extras = {},
} = {}) {
  const states = Object.create(null);
  const systemRegistry = { ...systems };
  const sources = [constants, indexes, core, adapters, extras];
  const target = {
    data,
    constants: Object.freeze({ ...constants }),
    indexes: Object.freeze({ ...indexes }),
    core: Object.freeze({ ...core }),
    adapters: Object.freeze({ ...adapters }),
    systems: systemRegistry,
    states,
    analysis: null,
  };

  const engine = new Proxy(target, {
    get(object, property, receiver) {
      if (Reflect.has(object, property)) return Reflect.get(object, property, receiver);
      for (const source of sources)
        if (source && property in source) return source[property];
      if (property === "stateEngine") return receiver;
      if (property === "MapRules") return systemRegistry.map;
      if (property === "combatRules") return systemRegistry.combat;
      if (property === "operationsRules") return systemRegistry.operations;
      for (const system of Object.values(systemRegistry))
        if (system && property in system) return system[property];
      return undefined;
    },
    set() {
      throw new Error("Engine is immutable");
    },
  });

  target.registerStates = (...groups) => {
    for (const group of groups.filter(Boolean)) {
      for (const [name, handler] of Object.entries(group)) {
        if (states[name]) throw new Error(`Duplicate state registration: ${name}`);
        states[name] = Object.freeze({ ...handler });
      }
    }
    return engine;
  };

  target.prompt = (state, builder) => {
    const handler = states[state.state];
    if (!handler?.prompt) return false;
    handler.prompt(state, builder);
    return true;
  };

  target.dispatch = (state, action, arg, current) => {
    const handler = states[state.state]?.[action];
    if (typeof handler !== "function" || action === "prompt") return false;
    handler(state, arg, current);
    return true;
  };

  target.message = (state) => {
    const value = states[state.state]?.message;
    return typeof value === "function" ? value(state) : value || null;
  };

  target.hasState = (name) => Boolean(states[name]);
  target.stateNames = () => Object.keys(states);

  target.view = (state, role) => {
    const viewSystem = systemRegistry.view;
    if (typeof viewSystem?.publicView !== "function")
      throw new Error("Engine view system is not configured");
    return viewSystem.publicView(state, role);
  };

  target.registerAnalysis = (analysis) => {
    if (target.analysis) throw new Error("Engine analysis is already configured");
    target.analysis = Object.freeze(analysis);
    return target.analysis;
  };

  for (const [name, factory] of Object.entries(systemFactories)) {
    if (systemRegistry[name]) throw new Error(`Duplicate system registration: ${name}`);
    if (typeof factory !== "function")
      throw new Error(`Invalid system factory: ${name}`);
    systemRegistry[name] = factory(engine);
  }
  Object.freeze(systemRegistry);

  if (stateFactories.length)
    target.registerStates(...stateFactories.map((factory) => factory(engine)));

  return engine;
}

module.exports = { createEngine };
