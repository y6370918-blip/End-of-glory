"use strict";

const { semanticDiff } = require("./semantic-diff.js");

const HINT_ORDER = Object.freeze({
  rule_forbidden: 0,
  event_restriction: 0,
  early_occupation_depth: 0,
  theater_inactive: 0,
  not_adjacent: 1,
  connection_mode: 1,
  enemy_blocked: 2,
  fort_blocked: 2,
  control_blocked: 2,
  overstack: 3,
  movement_points: 4,
  sr_points: 4,
  already_moved: 5,
  already_attacked: 5,
  already_used_sr: 5,
  hq_escort: 0,
  nationality: 0,
  supply: 0,
});

const HINT_LABELS = Object.freeze({
  rule_forbidden: "规则禁止在当前状态执行此动作",
  event_restriction: "当前事件或卡牌限制此动作",
  early_occupation_depth: "超出占领纵深",
  theater_inactive: "该战区尚未启用",
  not_adjacent: "目标与当前位置不相邻",
  connection_mode: "这条连接不允许当前行动使用",
  enemy_blocked: "敌军阻挡该地区",
  fort_blocked: "敌方要塞阻挡该行动",
  control_blocked: "控制权不符合行动要求",
  overstack: "行动结束后将超过堆叠上限",
  movement_points: "剩余移动力不足",
  sr_points: "剩余战略调动点不足",
  already_moved: "该单位本行动轮已经移动",
  already_attacked: "该单位本行动轮已经进攻",
  already_used_sr: "该单位本次战略调动已经使用",
  hq_escort: "将领缺少合格护送单位",
  nationality: "国籍或协同关系不符合要求",
  supply: "补给状态不允许执行此动作",
});

function supplyStatus(unit) {
  if (unit?.supplied !== false) return "full";
  if (unit?.limited_supply) return "limited";
  if (unit?.fort_limited_supply) return "fort_limited";
  return "none";
}

function supplyEffects(unit) {
  switch (supplyStatus(unit)) {
    case "limited":
      return [
        { code: "attack_column", label: "作为进攻单位时火力列左移 1 列" },
        { code: "movement_attack", label: "不能移动后进攻" },
        { code: "construction", label: "可以正常掘壕和组合" },
        { code: "replacement_points", label: "不能使用补员点" },
      ];
    case "fort_limited":
      return [
        { code: "attack_column", label: "作为进攻单位时火力列左移 1 列" },
        { code: "movement_attack", label: "不能移动后进攻" },
        { code: "construction", label: "可以正常掘壕和组合；离开要塞后必须停止或恢复补给" },
        { code: "replacement_points", label: "不能使用补员点" },
      ];
    case "none":
      return [
        { code: "activation", label: "不能普通移动、进攻、修筑、组合或战略调动" },
        { code: "replacement", label: "LCU 被消灭时永久移除且不放置 SCU 替换" },
        { code: "replacement_points", label: "不能使用补员点修复或重建" },
      ];
    default:
      return [{ code: "full", label: "补给充足，无补给惩罚" }];
  }
}

function hint(action, code, label = HINT_LABELS[code], importance = "normal") {
  return { action, code, label: label || code, importance };
}

function sortHints(items) {
  return items
    .filter(Boolean)
    .sort((a, b) => (HINT_ORDER[a.code] ?? 99) - (HINT_ORDER[b.code] ?? 99));
}

function addHint(table, id, entry) {
  if (!id || !entry) return;
  table[id] ||= [];
  if (!table[id].some((item) => item.action === entry.action && item.code === entry.code))
    table[id].push(entry);
}

function legalSet(actions, action) {
  return new Set(Array.isArray(actions?.[action]) ? actions[action] : []);
}

function candidateNeighbors(state, context) {
  const origins = new Set();
  if (state.state === "movement") {
    for (const id of state.ops?.movement?.active_units || []) {
      const unit = state.units.find((candidate) => candidate.id === id);
      if (unit?.location) origins.add(unit.location);
    }
  } else if (state.state === "ops_attack") {
    for (const id of state.ops?.attack_selection || []) {
      const unit = state.units.find((candidate) => candidate.id === id);
      if (unit?.location) origins.add(unit.location);
    }
  } else if (state.state === "retreat") {
    for (const id of [state.pending_retreat?.selected_unit].filter(Boolean)) {
      const unit = state.units.find((candidate) => candidate.id === id);
      if (unit?.location) origins.add(unit.location);
    }
  } else if (state.state === "advance_destination") {
    for (const id of state.pending_retreat?.selected_advance_units || []) {
      const unit = state.units.find((candidate) => candidate.id === id);
      if (unit?.location) origins.add(unit.location);
    }
  } else if (state.state === "sr") {
    const id = state.sr?.selected_unit;
    const unit = state.units.find((candidate) => candidate.id === id);
    if (unit?.location) origins.add(unit.location);
  }
  const candidates = new Set();
  const action = {
    movement: "move",
    ops_attack: "declare_attack",
    sr: "sr_destination",
    retreat: "retreat_destination",
    advance_destination: "advance_destination",
  }[state.state];
  const exact = context.candidateSpaces?.(state, action, origins);
  if (exact)
    for (const destination of exact) candidates.add(destination);
  else
    for (const origin of origins)
      for (const destination of context.landNeighbors(origin)) candidates.add(destination);
  return { origins, candidates };
}

function inferSpaceReason(state, faction, action, destination, origins, context) {
  const exact = context.explainSpaceAction?.(
    state,
    action,
    destination,
    origins,
  );
  if (exact)
    return hint(
      action,
      exact.code,
      exact.label || HINT_LABELS[exact.code],
      exact.importance || "normal",
    );
  if (!context.spaceCanActivate(state, destination))
    return hint(action, "theater_inactive", undefined, "important");
  const enemy = context.unitsAt(state, destination, context.other(faction));
  if (enemy.length && ["move", "sr_destination", "retreat_destination", "advance_destination"].includes(action))
    return hint(action, "enemy_blocked");
  if (action === "move") {
    const modeAllowed = [...origins].some((origin) =>
      context.connectionAllows(origin, destination, "move", faction),
    );
    if (!modeAllowed) return hint(action, "connection_mode");
    return hint(action, "movement_points");
  }
  if (action === "declare_attack") {
    const modeAllowed = [...origins].some((origin) =>
      context.connectionAllows(origin, destination, "attack", faction),
    );
    return modeAllowed
      ? hint(action, "rule_forbidden")
      : hint(action, "connection_mode");
  }
  if (action === "sr_destination") return hint(action, "sr_points");
  if (action === "retreat_destination") return hint(action, "rule_forbidden");
  if (action === "advance_destination") return hint(action, "rule_forbidden");
  return hint(action, "rule_forbidden");
}

function pieceContext(state, actions, result, context) {
  const legalPieces = new Set();
  for (const action of [
    "select_move_unit",
    "select_attacker",
    "select_sr_unit",
    "select_retreat_unit",
    "select_retreat_one",
    "select_retreat_two",
    "select_advance_unit",
  ])
    for (const id of Array.isArray(actions?.[action]) ? actions[action] : []) legalPieces.add(id);

  let relevantAction = null;
  if (["ops_move", "movement_units"].includes(state.state)) relevantAction = "select_move_unit";
  else if (state.state === "ops_attack") relevantAction = "select_attacker";
  else if (state.state === "sr") relevantAction = "select_sr_unit";
  else if (state.state === "retreat" && !state.pending_retreat?.selected_unit)
    relevantAction = "select_retreat_unit";
  else if (state.state === "advance_select") relevantAction = "select_advance_unit";
  if (!relevantAction) return;

  const origin = state.ops?.move_selection?.origin;
  for (const unit of state.units) {
    if (unit.faction !== state.active || legalPieces.has(unit.id)) continue;
    if (origin && unit.location !== origin) continue;
    const exact = context.explainPieceAction?.(state, relevantAction, unit);
    let code = exact?.code || "rule_forbidden";
    if (!exact) {
      if (unit.moved) code = "already_moved";
      else if (unit.attacked) code = "already_attacked";
      else if (state.sr?.used_units?.includes(unit.id)) code = "already_used_sr";
      else if (supplyStatus(unit) === "none" && relevantAction === "select_sr_unit") code = "supply";
      else if (unit.type === "hq") code = "hq_escort";
    }
    addHint(
      result.pieces,
      unit.id,
      hint(
        relevantAction,
        code,
        exact?.label || HINT_LABELS[code],
        exact?.importance || "normal",
      ),
    );
  }
}

function actionHints(state, faction, actions, context) {
  const result = {
    context: null,
    spaces: {},
    pieces: {},
  };
  if (!faction || faction !== state.active || !actions) return result;

  const actionByState = {
    movement: "move",
    ops_attack: "declare_attack",
    sr: "sr_destination",
    retreat: "retreat_destination",
    advance_destination: "advance_destination",
  };
  const action = actionByState[state.state];
  if (action) {
    const { origins, candidates } = candidateNeighbors(state, context);
    const legal = legalSet(actions, action);
    result.context = {
      kind: state.state,
      id: [...origins].join(",") || null,
    };
    for (const destination of candidates)
      if (!legal.has(destination))
        addHint(
          result.spaces,
          destination,
          inferSpaceReason(state, faction, action, destination, origins, context),
        );
  }
  pieceContext(state, actions, result, context);
  for (const table of [result.spaces, result.pieces])
    for (const [id, items] of Object.entries(table)) table[id] = sortHints(items);
  return result;
}

function rollbackEntries(
  state,
  role = null,
  maximumLogs = 20,
  snapshotAt = null,
) {
  return (state.rollback || []).map((entry, index) => {
    const snapshot =
      typeof snapshotAt === "function" ? snapshotAt(index) : entry.state || {};
    const cursor = Number.isInteger(entry.log_cursor)
      ? entry.log_cursor
      : Array.isArray(entry.state?.log)
        ? entry.state.log.length
        : 0;
    const removed = (state.log || []).slice(cursor);
    const omitted = Math.max(0, removed.length - maximumLogs);
    return {
      index,
      turn: entry.turn,
      round: entry.round,
      group: `T${entry.turn}:AR${entry.round || 0}`,
      kind: entry.kind,
      label: entry.label,
      log_cursor: cursor,
      removed_logs: removed.slice(-maximumLogs),
      omitted_logs: omitted,
      changes: semanticDiff(snapshot || {}, state, role),
    };
  });
}

module.exports = {
  HINT_LABELS,
  actionHints,
  rollbackEntries,
  supplyEffects,
  supplyStatus,
};
