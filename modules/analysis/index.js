"use strict";

const { semanticDiff } = require("./semantic-diff.js");

function createAnalysis({
  clone,
  view,
  action,
  allows,
  movementAllowance = () => 0,
  srTransport = () => "land_or_port_network",
}) {
  const position = (state, role) => view(clone(state), role);

  function publicPosition(state, role) {
    const result = position(state, role);
    return {
      version: 1,
      role,
      position: result,
    };
  }

  function explain(state, role, request = {}) {
    const result = position(state, role);
    const target = request.target ?? request.arg;
    const permitted = allows(result.actions, request.action, target);
    const spaceHints = result.action_hints?.spaces?.[String(target)] || [];
    const pieceHints = result.action_hints?.pieces?.[String(target)] || [];
    const details = {};
    if (permitted && request.action === "move") {
      details.path = [...(state.ops?.movement?.path || []), target];
      details.units = (state.ops?.movement?.active_units || []).slice();
    } else if (permitted && request.action === "sr_destination") {
      const selected = state.sr?.selected_unit;
      const unit = [
        ...(state.units || []),
        ...(state.reserves?.ap || []),
        ...(state.reserves?.cp || []),
      ].find((candidate) => candidate.id === selected);
      details.unit = selected || null;
      details.cost = state.sr?.free ? 1 : unit?.type === "army" ? 3 : 1;
      details.transport = srTransport(state, selected, target);
    } else if (permitted && request.action === "declare_attack") {
      details.attackers = (state.ops?.attack_selection || []).slice();
      details.target = target;
    }
    return {
      version: 1,
      action: request.action,
      target,
      legal: permitted,
      reasons: permitted
        ? []
        : [...spaceHints, ...pieceHints].filter(
            (entry) => !request.action || entry.action === request.action,
          ),
      details,
    };
  }

  function candidateAnalysis(state, role, actionName, candidates = []) {
    const result = position(state, role);
    const offered = Array.isArray(result.actions?.[actionName])
      ? result.actions[actionName]
      : [];
    const requested = candidates.length
      ? candidates
      : [
          ...offered,
          ...Object.keys(result.action_hints?.spaces || {}),
          ...Object.keys(result.action_hints?.pieces || {}),
        ];
    const analyzed = [...new Set(requested)].map((target) => {
      const explanation = explain(state, role, { action: actionName, target });
      if (!explanation.legal) return explanation;
      const before = clone(state);
      const after = clone(state);
      action(after, role, actionName, target);
      const result = { ...explanation, changes: semanticDiff(before, after, role) };
      const afterView = view(after, role);
      if (actionName === "move") {
        result.path = after.ops?.movement?.path?.slice() || [];
        result.units = (after.ops?.movement?.units || []).map((id) => {
          const unit = after.units?.find((candidate) => candidate.id === id);
          return {
            id,
            spent: after.ops?.movement?.spent_by_unit?.[id] || 0,
            remaining: Math.max(0, Number(movementAllowance(unit)) - Number(after.ops?.movement?.spent_by_unit?.[id] || 0)),
            stopped: after.ops?.movement?.stopped_units?.includes(id) || false,
          };
        });
        result.final_stack = after.units?.filter((unit) => unit.location === target).map((unit) => unit.id) || [];
      } else if (actionName === "sr_destination") {
        result.cost = Math.max(0, Number(before.sr?.remaining || 0) - Number(after.sr?.remaining || 0));
        result.remaining = Number(after.sr?.remaining || 0);
        result.transport = srTransport(before, before.sr?.selected_unit, target);
      } else if (actionName === "declare_attack") {
        result.preview = afterView.pending_attack || null;
      }
      return result;
    });
    return {
      version: 1,
      action: actionName,
      candidates: analyzed,
    };
  }

  function simulate(state, role, sequence = []) {
    const working = clone(state);
    const initial = clone(state);
    const steps = [];
    for (const request of sequence) {
      const beforeView = view(working, role);
      const arg = request.arg ?? request.target;
      if (!allows(beforeView.actions, request.action, arg)) {
        steps.push({
          action: request.action,
          arg,
          legal: false,
          explanation: explain(working, role, { action: request.action, target: arg }),
        });
        break;
      }
      const seed = working.seed;
      const before = clone(working);
      const probe = clone(working);
      action(probe, role, request.action, arg);
      if (seed !== probe.seed) {
        steps.push({
          action: request.action,
          arg,
          legal: true,
          consumes_randomness: true,
          executed: false,
          stopped_before_randomness: true,
          diff: semanticDiff(before, before, role),
        });
        break;
      }
      for (const key of Object.keys(working)) delete working[key];
      Object.assign(working, probe);
      steps.push({
        action: request.action,
        arg,
        legal: true,
        consumes_randomness: false,
        executed: true,
        diff: semanticDiff(before, working, role),
      });
    }
    return {
      version: 1,
      steps,
      changed: semanticDiff(initial, working, role),
      final: view(working, role),
    };
  }

  return Object.freeze({
    public_position_v1: publicPosition,
    explain_action_v1: explain,
    movement_analysis_v1: (state, role, candidates = []) =>
      candidateAnalysis(state, role, "move", candidates),
    sr_analysis_v1: (state, role, candidates = []) =>
      candidateAnalysis(state, role, "sr_destination", candidates),
    combat_preview_v1: (state, role, candidates = []) => {
      const result = position(state, role);
      return {
        version: 1,
        candidates: candidateAnalysis(state, role, "declare_attack", candidates).candidates,
        preview: result.pending_attack || null,
      };
    },
    simulate_action_sequence_v1: simulate,
  });
}

module.exports = { createAnalysis };
