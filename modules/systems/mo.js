"use strict";

function createMoSystem(api) {
  const { AP, CP, MO_NATIONS: nations } = api;
  function moFaction(nation) {
    return nations[CP].includes(nation) ? CP : AP;
  }

  function moRequiredCount(mo) {
    return Math.max(1, Number(mo?.attacks) || 1);
  }

  function moKind(mo) {
    if (["task", "none", "passive", "prohibition"].includes(mo?.kind))
      return mo.kind;
    if (mo?.prohibition) return "prohibition";
    if (mo?.passive) return "passive";
    if (mo?.attacks > 0 || mo?.requirement) return "task";
    return "none";
  }

  function moIsTask(mo) {
    return moKind(mo) === "task";
  }

  function moResolution(state, nation, id) {
    if ((state.mo.completed[nation] || []).includes(id)) return "completed";
    if ((state.mo.waived[nation] || []).includes(id)) return "waived";
    if ((state.mo.penalized[nation] || []).includes(id)) return "penalized";
    return null;
  }

  function moIsResolved(state, nation, id) {
    return moResolution(state, nation, id) !== null;
  }

  function moIsPenaltyObligation(mo) {
    return Boolean(
      mo && moIsTask(mo) && mo.counts_for_penalty !== false &&
      !mo.prohibition && !mo.passive &&
      (mo.attacks > 0 || mo.requirement),
    );
  }

  

  function moBagDefinitions(state, nation) {
      return [
          ...(api.data.mo[nation] || []),
          ...(state.mo.pool[nation] || []).filter((entry) => !entry.expires_turn || entry.expires_turn >= state.turn),
      ].filter((definition) => moAvailable(state, definition));
  }

  function moAvailable(state, definition) {
      if (!definition)
          return false;
      const requiredAll = definition.requires_all_events || [];
      const requiredAny = definition.requires_any_events || [];
      const hasUnlockCondition = Boolean(definition.requires_event || requiredAll.length || requiredAny.length);
      // Printed MO counters outside the photographed opening bags are templates
      // for later event additions. They must never leak into the initial bag merely
      // because their artwork exists in data.mo.
      if (api.moById[definition.id] && definition.image_source &&
          !definition.initial_bag &&
          !hasUnlockCondition)
          return false;
      return Boolean((!definition.requires_event || state.events[definition.requires_event]) &&
          requiredAll.every((event) => state.events[event]) &&
          (!requiredAny.length || requiredAny.some((event) => state.events[event])));
  }

  function drawMoForNation(state, nation, count) {
      const definitions = moBagDefinitions(state, nation);
      const byId = Object.fromEntries(definitions.map((mo) => [mo.id, mo]));
      const valid = new Set(Object.keys(byId));
      let bag = (state.mo.bag[nation] || []).filter((id) => valid.has(id));
      let drawn = (state.mo.drawn[nation] || []).filter((id) => valid.has(id));
      for (const id of valid)
          if (!bag.includes(id) && !drawn.includes(id))
              bag.push(id);
      if (drawn.length * 2 >= valid.size && drawn.length) {
          bag = [...valid];
          drawn = [];
          api.log(state, `${nation.toUpperCase()} MO：已抽出半数，全部洗回。`);
      }
      const selected = [];
      const pull = () => {
          const index = Math.floor(api.random(state) * bag.length);
          return bag.splice(index, 1)[0];
      };
      while (selected.length < count && bag.length)
          selected.push(pull());
      if (selected.length < count && drawn.length) {
          bag = drawn.filter((id) => !selected.includes(id));
          drawn = selected.slice();
          api.log(state, `${nation.toUpperCase()} MO：抽完余下标记后洗回旧标记。`);
          while (selected.length < count && bag.length)
              selected.push(pull());
      }
      drawn.push(...selected.filter((id) => !drawn.includes(id)));
      state.mo.bag[nation] = bag;
      state.mo.drawn[nation] = drawn;
      return selected.map((id) => byId[id]).filter(Boolean);
  }

  function drawMo(state) {
      state.mo.current = {};
      state.mo.completed = {};
      state.mo.progress = {};
      state.mo.drm_used = {};
      state.mo.targets = {};
      state.mo.review = { confirmed: [] };
      state.mo.revealed = [];
      state.mo.waived = {};
      state.mo.penalized = {};
      state.mo.front_commitments = {};
      const draws = state.turn === 1
          ? { fr: 2, br: 0, it: 0, us: 0, ge: 2, ah: 0 }
          : {
              fr: 2,
              br: 1,
              it: api.italianTheaterActive(state) ? 1 : 0,
              us: 0,
              ge: 2,
              ah: api.italianTheaterActive(state) ? 1 : 0,
          };
      for (const [nation, baseCount] of Object.entries(draws)) {
          const configured = state.mo.draw_count[nation];
          const withBonus = (configured == null ? baseCount : configured) +
              (state.mo.draw_bonus[nation] || 0);
          const count = Math.min(withBonus, state.mo.draw_limit[nation] ?? Number.POSITIVE_INFINITY);
          const selected = drawMoForNation(state, nation, count);
          state.mo.current[nation] = selected.map((mo) => mo.id);
          state.mo.completed[nation] = [];
          state.mo.progress[nation] = Object.fromEntries(selected.map((mo) => [mo.id, 0]));
          state.mo.drm_used[nation] = Object.fromEntries(selected.map((mo) => [mo.id, 0]));
          state.mo.targets[nation] = Object.fromEntries(selected.map((mo) => [mo.id, []]));
      }
      delete state.mo.order;
      delete state.mo.index;
      api.log(state, `T${state.turn} 双方强制进攻已私下抽取。`);
  }

  function unfulfilledMoObligations(state) {
      const byFaction = { [api.AP]: [], [api.CP]: [] };
      for (const [nation, ids] of Object.entries(state.mo.current)) {
          const completed = new Set(state.mo.completed[nation] || []);
          const committed = new Set(Object.values(state.mo.front_commitments || {})
              .filter((entry) => entry?.turn === state.turn && entry.nation === nation)
              .map((entry) => entry.id));
          const obligations = ids.filter((id) => {
              const mo = moDefinition(state, id);
              return api.moIsPenaltyObligation(mo);
          });
          const required = Math.min(obligations.length, state.mo.completion_required[nation] ?? obligations.length);
          const fulfilled = obligations.filter((id) => completed.has(id) || committed.has(id)).length;
          const missed = Math.max(0, required - fulfilled);
          const faction = api.moFaction(nation);
          const unfinished = obligations.filter((candidate) =>
              !moIsResolved(state, nation, candidate) && !committed.has(candidate));
          for (const id of unfinished)
              revealMo(state, id);
          for (const id of unfinished.slice(0, missed))
              byFaction[faction].push({ faction, nation, id });
          for (const id of unfinished.slice(missed)) {
              state.mo.waived[nation] ||= [];
              if (!state.mo.waived[nation].includes(id)) {
                  state.mo.waived[nation].push(id);
                  recordMoHistory(state, nation, id, "waived", "completion_required");
                  api.log(state, `${nation.toUpperCase()} 强制进攻 [[mo:${id}]] 免除处罚。`);
              }
          }
      }
      const factions = [api.AP, api.CP].filter((faction) => byFaction[faction].length);
      if (factions.length < 2)
          return factions.flatMap((faction) => byFaction[faction]);
      const chooserFirst = byFaction[api.AP].length < byFaction[api.CP].length
          ? api.AP : byFaction[api.CP].length < byFaction[api.AP].length
          ? api.CP : state.first_player;
      return [api.other(chooserFirst), chooserFirst].flatMap((faction) => byFaction[faction]);
  }

  function moPenaltyAttackOptions(state, faction, excluded = [], excludedTargets = []) {
      const blockedTargets = new Set(excludedTargets);
      return api.forcedAttackCandidates(state, faction, excluded, {
          requireSupply: true,
      }).map((origin) => {
          const stack = api.unitsAt(state, origin, faction).filter(api.isCombatUnit);
          const attackers = stack.map((unit) => unit.id);
          const targets = api.neighborsFor(origin, "attack", faction).filter((target) => !blockedTargets.has(target) && attackers.every((id) => {
              const unit = state.units.find((candidate) => candidate.id === id);
              return unit && api.attacksTarget(state, unit, target);
          }) &&
              (api.unitsAt(state, target, api.other(faction)).some(api.isCombatUnit) ||
                  (api.intactFort(state, target) &&
                      api.spaceById[target]?.faction !== faction)));
          return { origin, attackers, targets };
      }).filter((entry) => entry.attackers.length && entry.targets.length);
  }

  function moPenaltyAttackSelectionOptions(state, pending) {
      const selected = pending?.selected || [];
      return api.forcedAttackCandidates(state, pending.penalized, selected, {
          requireSupply: true,
      });
  }

  function moPenaltyLossCandidates(state, faction, nation) {
      return [...state.units, ...(state.reserves[faction] || [])]
          .filter((unit) => {
          const piece = api.pieceById[unit.piece];
          return ((unit.faction || piece?.faction) === faction &&
              ["army", "corps"].includes(unit.type || piece?.type) &&
              api.nationalityGroup(unit.nation || piece?.nation) ===
                  api.nationalityGroup(nation) &&
              api.acceptsReplacementPoints(unit) &&
              !unit.reduced);
      })
          .map((unit) => unit.id);
  }

  function unitRepairCost(unit) {
      if (!unit) return 0;
      if (unit.type === "army") return 1;
      if (unit.type === "corps") return 0.5;
      return 0;
  }

  function moPenaltyLossValue(state, id) {
      const unit = [...state.units, ...state.reserves.ap, ...state.reserves.cp].find((candidate) => candidate.id === id);
      return unitRepairCost(unit);
  }

  function moPenaltySelectedValue(state, pending) {
      return (pending.selected_units || []).reduce((sum, id) => sum + moPenaltyLossValue(state, id), 0);
  }

  function moPenaltyLossSelectionComplete(state, pending) {
      const selectedValue = moPenaltySelectedValue(state, pending);
      return selectedValue === pending.loss_required;
  }

  function moPenaltyLossCanPay(state, faction, nation, required = 2) {
      const values = moPenaltyLossCandidates(state, faction, nation)
          .map((id) => moPenaltyLossValue(state, id));
      const search = (index, remaining) => {
          if (Math.abs(remaining) < 1e-9) return true;
          if (remaining < 0 || index >= values.length) return false;
          return search(index + 1, remaining) || search(index + 1, remaining - values[index]);
      };
      return search(0, required);
  }

  function commitMoPenaltyLoss(state) {
      const pending = state.pending_event;
      if (pending?.kind !== "mo_penalty" || pending.stage !== "loss")
          throw new Error("MO loss selection is not active");
      if (!moPenaltyLossSelectionComplete(state, pending))
          throw new Error("Select 2 RP of full-strength combat units");
      const legal = new Set(moPenaltyLossCandidates(state, pending.penalized, pending.nation));
      for (const id of pending.selected_units || []) {
          if (!legal.has(id))
              throw new Error("Illegal MO penalty unit");
          const unit = [
              ...state.units,
              ...(state.reserves[pending.penalized] || []),
          ].find((candidate) => candidate.id === id);
          if (unit)
              unit.reduced = true;
      }
      api.log(state, `未完成MO处罚：以 ${moPenaltySelectedValue(state, pending)} RP 等值的非致命减员结算。`);
      advanceMoPenalty(state);
  }

  function beginCurrentMoPenalty(state) {
      const resolution = state.mo.penalty_resolution;
      const obligation = resolution?.queue[resolution.index];
      if (!obligation) {
          delete state.mo.penalty_resolution;
          api.beginAttrition(state);
          return false;
      }
      api.updateSupply(state);
      const chooser = api.other(obligation.faction);
      const attackOptions = moPenaltyAttackOptions(state, obligation.faction);
      const forcedAttackProbe = {
          penalized: obligation.faction,
          required: 2,
          selected: [],
      };
      const requiredAttacks = attackOptions.length >= 2 &&
          moPenaltyAttackSelectionOptions(state, forcedAttackProbe).length
          ? 2
          : 0;
      const lossCanPay = moPenaltyLossCanPay(state, obligation.faction, obligation.nation, 2);
      if (!requiredAttacks && !lossCanPay) {
          state.mo.waived[obligation.nation] ||= [];
          if (!state.mo.waived[obligation.nation].includes(obligation.id)) {
              state.mo.waived[obligation.nation].push(obligation.id);
              revealMo(state, obligation.id);
              recordMoHistory(state, obligation.nation, obligation.id, "exhausted", "mo_penalty");
              api.log(state, `${obligation.nation.toUpperCase()} 未完成MO [[mo:${obligation.id}]]：所有合法处罚手段均已耗尽。`);
          }
          resolution.index += 1;
          return beginCurrentMoPenalty(state);
      }
      state.pending_event = {
          kind: "mo_penalty",
          owner: chooser,
          chooser,
          penalized: obligation.faction,
          nation: obligation.nation,
          mo: obligation.id,
          stage: "mode",
          selected: [],
          required: requiredAttacks,
          loss_required: lossCanPay ? 2 : 0,
      };
      state.phase = "未完成强制进攻";
      api.enterEventFlow(state);
      api.setActiveFaction(state, chooser);
      return true;
  }

  function beginMoPenaltyResolution(state) {
      const queue = unfulfilledMoObligations(state);
      if (!queue.length)
          return false;
      state.mo.penalty_resolution = { queue, index: 0 };
      api.log(state, `未完成强制进攻：${queue.length} 个 MO 需要结算。`);
      return beginCurrentMoPenalty(state);
  }

  function advanceMoPenalty(state) {
      const obligation = state.mo.penalty_resolution?.queue?.[state.mo.penalty_resolution?.index];
      if (obligation) {
          state.mo.penalized[obligation.nation] ||= [];
          if (!state.mo.penalized[obligation.nation].includes(obligation.id)) {
              state.mo.penalized[obligation.nation].push(obligation.id);
              revealMo(state, obligation.id);
              recordMoHistory(state, obligation.nation, obligation.id, "penalized");
              api.log(state, `${obligation.nation.toUpperCase()} 未完成强制进攻 [[mo:${obligation.id}]] 已结算处罚。`);
          }
      }
      state.pending_event = null;
      const resolution = state.mo.penalty_resolution;
      if (!resolution) {
          api.beginAttrition(state);
          return;
      }
      resolution.index += 1;
      beginCurrentMoPenalty(state);
  }

  function commitMoPenaltyAttacks(state, pending) {
      if (pending.selected.length !== pending.required)
          throw new Error("Select every required forced attack");
      if (new Set(pending.selected).size !== pending.required)
          throw new Error("Forced attacks require different origins");
      const spaces = pending.selected.slice();
      state.pending_event = null;
      api.commitForcedAttackMarkers(state, {
          spaces,
          faction: pending.penalized,
          source: "mo_penalty",
          sourceId: pending.mo,
          returnAfterForced: "mo_penalty",
          candidateOptions: { requireSupply: true },
      });
  }

  function revealMo(state, id) {
      state.mo.revealed ||= [];
      if (!state.mo.revealed.includes(id))
          state.mo.revealed.push(id);
  }

  function recordMoHistory(state, nation, id, outcome, detail = null) {
      state.mo.history ||= [];
      const entry = { turn: state.turn, nation, id, outcome };
      if (detail)
          entry.detail = detail;
      state.mo.history.push(entry);
      return entry;
  }

  function resolveNonTaskMo(state, nation, id, outcome = null) {
      const definition = moDefinition(state, id);
      const kind = outcome || api.moKind(definition);
      if (!["none", "passive", "prohibition", "exhausted", "waived"].includes(kind))
          throw new Error(`Invalid non-task MO outcome ${kind}`);
      state.mo.waived[nation] ||= [];
      if (moIsResolved(state, nation, id))
          return false;
      state.mo.waived[nation].push(id);
      revealMo(state, id);
      recordMoHistory(state, nation, id, kind);
      api.log(state, `${nation.toUpperCase()} 强制进攻 [[mo:${id}]]：${kind === "none" ? "无强制进攻" : kind === "passive" ? "被动效果生效" : kind === "prohibition" ? "禁止效果生效" : kind === "exhausted" ? "所有合法支付手段均已耗尽" : "免除"}。`);
      return true;
  }

  function completeMo(state, nation, id, detail = null) {
      const definition = moDefinition(state, id);
      if (definition && !api.moIsTask(definition))
          return false;
      state.mo.completed[nation] ||= [];
      if (moIsResolved(state, nation, id))
          return false;
      state.mo.completed[nation].push(id);
      revealMo(state, id);
      recordMoHistory(state, nation, id, "completed", detail);
      const reward = moDefinition(state, id)?.reward_rp || 0;
      if (reward) {
          const faction = ["ge", "ah"].includes(nation) ? api.CP : api.AP;
          const key = faction === api.CP
              ? nation === "ge"
                  ? "ge"
                  : "ah"
              : nation === "fr"
                  ? "fr"
                  : nation === "it"
                      ? "it"
                      : nation === "us"
                          ? "us"
                          : "br";
          state.rp[faction][key] = (state.rp[faction][key] || 0) + reward;
      }
      api.log(state, `${nation.toUpperCase()} 完成强制进攻 [[mo:${id}]]${reward ? `，获得 ${reward} RP` : ""}。`);
      return true;
  }

  function moAutomaticallySatisfied(state, mo) {
      if (!mo)
          return false;
      return Boolean(mo.requirement === "advance_front" &&
          ((mo.collapse_position != null &&
              state.fronts[mo.front] >= mo.collapse_position) ||
              (mo.unless_event && state.events[mo.unless_event])));
  }

  function confirmMoReview(state, faction) {
      if (state.state !== "mo_review" || state.active !== faction)
          throw new Error("This faction cannot confirm MO now");
      state.mo.review ||= { confirmed: [] };
      if (state.mo.review.confirmed.includes(faction))
          throw new Error("MO already confirmed");
      api.clearUndo(state);
      for (const nation of api.MO_NATIONS[faction])
          for (const id of state.mo.current[nation] || [])
              if (!moIsResolved(state, nation, id)) {
                  const definition = moDefinition(state, id);
                  const kind = api.moKind(definition);
                  if (["none", "passive", "prohibition"].includes(kind))
                      resolveNonTaskMo(state, nation, id, kind);
                  else if (moAutomaticallySatisfied(state, definition)) {
                      state.mo.waived[nation] ||= [];
                      if (!state.mo.waived[nation].includes(id)) {
                          state.mo.waived[nation].push(id);
                          revealMo(state, id);
                          recordMoHistory(state, nation, id, "waived", "front_unavailable");
                      }
                  }
              }
      state.mo.review.confirmed.push(faction);
      api.log(state, `${api.factionRole(faction)}已确认本回合私有强制进攻。`);
      if (faction === api.CP) {
          api.setActiveFaction(state, api.AP);
          return;
      }
      api.startNaval(state);
  }

  function progressMo(state, nation, predicate, amount = 1) {
      const ids = state.mo.current[nation] || [];
      const pending = ids.find((id) => !moIsResolved(state, nation, id) && predicate(moDefinition(state, id)));
      if (!pending)
          return null;
      const definition = moDefinition(state, pending);
      state.mo.progress[nation] ||= {};
      const progress = (state.mo.progress[nation][pending] || 0) + amount;
      state.mo.progress[nation][pending] = progress;
      const required = Math.max(1, definition?.attacks || 1);
      if (progress >= required)
          completeMo(state, nation, pending);
      return pending;
  }

  function progressMoById(state, nation, id, amount = 1, detail = null) {
      if (!id || !(state.mo.current[nation] || []).includes(id))
          return null;
      if (moIsResolved(state, nation, id))
          return null;
      const definition = moDefinition(state, id);
      state.mo.progress[nation] ||= {};
      state.mo.progress[nation][id] =
          (state.mo.progress[nation][id] || 0) + amount;
      if (state.mo.progress[nation][id] >= api.moRequiredCount(definition))
          completeMo(state, nation, id, detail);
      return id;
  }

  function attackQualifiesForMo(attackingUnits, nation) {
      const group = api.nationalityGroup(nation);
      const nationalAttackers = attackingUnits.filter((unit) =>
          api.nationalityGroup(unit.nation) === group);
      return (nationalAttackers.some((unit) => unit.type === "army") ||
          nationalAttackers.filter((unit) => unit.type === "corps").length >= 3);
  }

  function moMarkerOriginsForNation(state, nation, declaration, attackingUnits = null) {
      const suppliedUnits = new Map((attackingUnits || []).map((unit) => [unit.id, unit]));
      const byOrigin = new Map();
      for (const id of declaration?.attackers || []) {
          const unit = suppliedUnits.get(id) ||
              state.units.find((candidate) => candidate.id === id);
          if (!unit || api.nationalityGroup(unit.nation) !== api.nationalityGroup(nation) || !unit.location)
              continue;
          if (!byOrigin.has(unit.location))
              byOrigin.set(unit.location, []);
          byOrigin.get(unit.location).push(unit);
      }
      return [...byOrigin.entries()]
          .filter(([origin]) => {
          const activation = state.activations?.[origin];
          return activation === "attack" ||
              state.ops?.forced_attacks?.includes(origin);
      })
          .filter(([, units]) => attackQualifiesForMo(units, nation))
          .map(([origin]) => origin)
          .sort();
  }

  function computeMoMarkerOrigins(state, declaration) {
      const nations = new Set((declaration?.attackers || [])
          .map((id) => api.nationalityGroup(state.units.find((unit) => unit.id === id)?.nation))
          .filter(Boolean));
      return Object.fromEntries([...nations]
          .map((nation) => [
          nation,
          moMarkerOriginsForNation(state, nation, declaration),
      ])
          .filter(([, origins]) => origins.length));
  }

  function moAttackMatches(state, mo, attackingUnits, nation, declaration) {
      const assignedRequirement = new Set([
          "destroy_enemy_army",
          "lose_friendly_army",
          "attack_win",
          "combat_win",
          "advance_after_combat",
      ]);
      if (!mo ||
          (!(mo.attacks > 0) && !assignedRequirement.has(mo.requirement)) ||
          (mo.requirement && !assignedRequirement.has(mo.requirement)))
          return false;
      const markerOrigins = moMarkerOriginsForNation(state, nation, declaration, attackingUnits);
      if (!markerOrigins.length)
          return false;
      const eligibleAttackers = attackingUnits.filter((unit) => moMarkerOriginsForNation(
          state,
          unit.nation,
          declaration,
          attackingUnits,
      ).includes(unit.location));
      const condition = mo.attack_condition;
      if (!condition)
          return true;
      const target = declaration.target;
      const origins = [
          ...new Set(eligibleAttackers
              .filter((unit) => api.nationalityGroup(unit.nation) === api.nationalityGroup(nation))
              .map((unit) => unit.location)),
      ];
      if (condition.mixed_with &&
          !eligibleAttackers.some((unit) => unit.nation === condition.mixed_with &&
              (!condition.mixed_type || unit.type === condition.mixed_type)))
          return false;
      if (condition.own_army &&
          !eligibleAttackers.some((unit) =>
              api.nationalityGroup(unit.nation) === api.nationalityGroup(nation) && unit.type === "army"))
          return false;
      if (condition.connection &&
          !origins.some((origin) => api.connectionRule(origin, target, condition.connection)))
          return false;
      if (condition.any?.length) {
          const matches = condition.any.some((entry) => {
              if (entry === "intact_fort")
                  return api.intactFort(state, target) > 0;
              if (entry === "trench")
                  return (state.trenches[target] || 0) > 0;
              if (entry === "port")
                  return Boolean(api.spaceById[target]?.port);
              if (entry === "mountain")
                  return api.spaceById[target]?.terrain === "mountain";
              if (entry === "swamp")
                  return api.spaceById[target]?.terrain === "swamp";
              if (entry === "river")
                  return (origins.length > 0 &&
                      origins.every((origin) => api.connectionRule(origin, target, "river")));
              return false;
          });
          if (!matches)
              return false;
      }
      if (mo.distinct_targets) {
          const used = state.mo.targets[nation]?.[mo.id] || [];
          if (used.includes(target))
              return false;
      }
      return true;
  }

  function attackMoCandidates(state, nation, attackingUnits, declaration) {
      if (nation === "ge" &&
          state.active === api.CP &&
          state.markers.killing_ground?.space === declaration.target &&
          attackQualifiesForMo(attackingUnits, nation) &&
          moMarkerOriginsForNation(state, nation, declaration, attackingUnits).length)
          return (state.mo.current[nation] || []).filter((id) => {
              if (moIsResolved(state, nation, id))
                  return false;
              const mo = moDefinition(state, id);
              return (api.moIsTask(mo) &&
                  ((mo?.attacks || 0) > 0 ||
                      [
                          "destroy_enemy_army",
                          "lose_friendly_army",
                          "attack_win",
                          "combat_win",
                          "advance_after_combat",
                      ].includes(mo?.requirement)));
          });
      return (state.mo.current[nation] || []).filter((id) => !moIsResolved(state, nation, id) &&
          moAttackMatches(state, moDefinition(state, id), attackingUnits, nation, declaration));
  }

  function attackMoChoices(state, declaration = state.ops?.pending_attack) {
      if (!declaration)
          return [];
      const attackingUnits = (declaration.attackers || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      return [...new Set(attackingUnits.map((unit) => unit.nation))]
          .map((nation) => ({
          nation,
          required: nation === "ge" &&
              state.active === api.CP &&
              state.markers.killing_ground?.space === declaration.target,
          candidates: attackMoCandidates(state, nation, attackingUnits, declaration),
      }))
          .filter((entry) => entry.candidates.length);
  }

  function attackMoChoicesComplete(state, declaration = state.ops?.pending_attack) {
      if (!declaration)
          return false;
      const decisions = declaration.mo_decisions || {};
      return attackMoChoices(state, declaration).every((entry) => Object.prototype.hasOwnProperty.call(decisions, entry.nation));
  }

  function attackMoOptionId(nation, id) {
      return `mo:${nation}:${id || "none"}`;
  }

  function selectAttackMo(state, option) {
      const pending = state.ops?.pending_attack;
      if (!pending)
          throw new Error("No pending attack");
      const choices = attackMoChoices(state, pending);
      const next = choices.find((entry) => !Object.prototype.hasOwnProperty.call(pending.mo_decisions || {}, entry.nation));
      if (!next)
          throw new Error("Every participating nation already chose an MO");
      const prefix = `mo:${next.nation}:`;
      if (typeof option !== "string" || !option.startsWith(prefix))
          throw new Error("Invalid MO option");
      const id = option.slice(prefix.length);
      if (id === "none" && next.required)
          throw new Error("Killing Ground requires a German offensive MO");
      if (id !== "none" && !next.candidates.includes(id))
          throw new Error("MO is not eligible for this attack");
      pending.mo_decisions ||= {};
      pending.mo_assignments ||= {};
      pending.mo_marker_origins = computeMoMarkerOrigins(state, pending);
      pending.mo_decisions[next.nation] = true;
      pending.mo_assignments[next.nation] = id === "none" ? null : id;
  }

  function pendingMoForAttack(state, nation, attackingUnits, declaration) {
      return ((state.mo.current[nation] || []).find((id) => !moIsResolved(state, nation, id) &&
          moAttackMatches(state, moDefinition(state, id), attackingUnits, nation, declaration)) || null);
  }

  function markMoForAttack(state, nation, id, declaration) {
      if (!id)
          id = (state.mo.current[nation] || []).find((candidate) => !moIsResolved(state, nation, candidate) &&
              (moDefinition(state, candidate)?.attacks || 0) > 0 &&
              !moDefinition(state, candidate)?.requirement);
      if (!id || moIsResolved(state, nation, id))
          return null;
      const definition = moDefinition(state, id);
      declaration ||= {
          target: `attack-${(state.mo.progress[nation]?.[id] || 0) + 1}`,
      };
      const markerOrigins = moMarkerOriginsForNation(state, nation, declaration);
      if (!markerOrigins.length)
          return null;
      state.mo.progress[nation] ||= {};
      state.mo.targets[nation] ||= {};
      state.mo.targets[nation][id] ||= [];
      if (definition?.distinct_targets &&
          state.mo.targets[nation][id].includes(declaration.target))
          return null;
      state.mo.targets[nation][id].push(declaration.target);
      let amount = definition?.distinct_targets ? 1 : markerOrigins.length;
      amount = Math.max(1, amount);
      const required = Math.max(1, definition?.attacks || 1);
      const current = state.mo.progress[nation][id] || 0;
      amount = Math.min(amount, Math.max(0, required - current));
      const progress = current + amount;
      state.mo.progress[nation][id] = progress;
      if (progress >= required)
          completeMo(state, nation, id);
      return id;
  }

  function markMoRequirement(state, nation, requirement, context = {}) {
      return progressMo(state, nation, (mo) => mo?.requirement === requirement &&
          (!mo.target || mo.target === context.target) &&
          (!mo.combat_condition?.both_armies || context.both_armies));
  }

  function markAdvanceMo(state, nation) {
      const combat = state.combat;
      if (!combat ||
          combat.attacker === api.other(["ge", "ah"].includes(nation) ? api.CP : api.AP))
          return null;
      const participants = (combat.participant_units || []).filter((unit) => combat.attackers.includes(unit.id));
      if (!attackQualifiesForMo(participants, nation))
          return null;
      combat.mo_advance_recorded ||= [];
      if (combat.mo_advance_recorded.includes(nation))
          return null;
      const id = combat.mo_assignments?.[nation];
      if (moDefinition(state, id)?.requirement !== "advance_after_combat")
          return null;
      combat.mo_advance_recorded.push(nation);
      return progressMoById(state, nation, id, 1, "advance_after_combat");
  }

  function passiveMoModifiers(state, nation, passive) {
      return (state.mo.current[nation] || [])
          .filter((id) => state.mo.revealed.includes(id))
          .map((id) => moDefinition(state, id))
          .filter((mo) => mo?.passive === passive);
  }

  function moAttackEffect(state, nation, attackingUnits, declaration) {
      const hasAssignments = declaration?.mo_assignments != null;
      const id = hasAssignments
          ? declaration.mo_assignments[nation]
          : pendingMoForAttack(state, nation, attackingUnits, declaration);
      if (!id)
          return null;
      if (!attackMoCandidates(state, nation, attackingUnits, declaration).includes(id))
          return null;
      const definition = moDefinition(state, id);
      const used = state.mo.drm_used[nation]?.[id] || 0;
      return {
          id,
          drm: used < (definition.attack_drm_uses || 0) ? definition.attack_drm || 0 : 0,
          column: used < (definition.attack_column_uses || 0)
              ? definition.attack_column || 0
              : 0,
          table: definition.attack_table || null,
      };
  }

  function defenseMoCandidates(state, nation, window = state.combat_window) {
      if (!window?.declaration)
          return [];
      const defenders = api.unitsAt(state, window.declaration.target, window.defender).filter(api.isCombatUnit);
      if (!attackQualifiesForMo(defenders, nation))
          return [];
      const attackers = (window.declaration.attackers || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const bothArmies = attackers.some((unit) => unit.type === "army") &&
          defenders.some((unit) => unit.type === "army");
      const completed = new Set(state.mo.completed[nation] || []);
      const waived = new Set(state.mo.waived[nation] || []);
      const penalized = new Set(state.mo.penalized[nation] || []);
      return (state.mo.current[nation] || []).filter((id) => {
          if (completed.has(id) || waived.has(id) || penalized.has(id))
              return false;
          const mo = moDefinition(state, id);
          if (!api.moIsTask(mo) ||
              !["defense_win", "defense_win_counterattack", "combat_win"].includes(mo.requirement))
              return false;
          return !mo.combat_condition?.both_armies || bothArmies;
      });
  }

  function defenseMoChoices(state, window = state.combat_window) {
      if (!window?.declaration)
          return [];
      const nations = new Set(api.unitsAt(state, window.declaration.target, window.defender)
          .filter(api.isCombatUnit)
          .map((unit) => unit.nation));
      return [...nations]
          .map((nation) => ({
          nation,
          candidates: defenseMoCandidates(state, nation, window),
      }))
          .filter((entry) => entry.candidates.length);
  }

  function defenseMoChoicesComplete(state, window = state.combat_window) {
      const decisions = window?.defense_mo_decisions || {};
      return defenseMoChoices(state, window).every((entry) => Object.prototype.hasOwnProperty.call(decisions, entry.nation));
  }

  function selectDefenseMo(state, option) {
      const window = state.combat_window;
      if (!window)
          throw new Error("No pending combat");
      const next = defenseMoChoices(state, window).find((entry) => !Object.prototype.hasOwnProperty.call(window.defense_mo_decisions || {}, entry.nation));
      if (!next)
          throw new Error("Every defending nation already chose an MO");
      const prefix = `mo:${next.nation}:`;
      if (typeof option !== "string" || !option.startsWith(prefix))
          throw new Error("Invalid defense MO option");
      const id = option.slice(prefix.length);
      if (id !== "none" && !next.candidates.includes(id))
          throw new Error("MO is not eligible for this defense");
      window.defense_mo_decisions ||= {};
      window.defense_mo_assignments ||= {};
      window.defense_mo_decisions[next.nation] = true;
      window.defense_mo_assignments[next.nation] = id === "none" ? null : id;
  }

  function moDefinition(state, id) {
      return (api.moById[id] ||
          Object.values(state.mo.pool)
              .flat()
              .find((entry) => entry.id === id) ||
          null);
  }
return Object.freeze({
    advanceMoPenalty,
    attackMoCandidates,
    attackMoChoices,
    attackMoChoicesComplete,
    attackMoOptionId,
    attackQualifiesForMo,
    beginCurrentMoPenalty,
    beginMoPenaltyResolution,
    commitMoPenaltyAttacks,
    commitMoPenaltyLoss,
    completeMo,
    computeMoMarkerOrigins,
    confirmMoReview,
    defenseMoCandidates,
    defenseMoChoices,
    defenseMoChoicesComplete,
    drawMo,
    drawMoForNation,
    markAdvanceMo,
    markMoForAttack,
    markMoRequirement,
    moAttackEffect,
    moAttackMatches,
    moAutomaticallySatisfied,
    moAvailable,
    moBagDefinitions,
    moDefinition,
    moFaction,
    moIsPenaltyObligation,
    moIsResolved,
    moIsTask,
    moKind,
    moMarkerOriginsForNation,
    moPenaltyAttackOptions,
    moPenaltyAttackSelectionOptions,
    moPenaltyLossCanPay,
    moPenaltyLossCandidates,
    moPenaltyLossSelectionComplete,
    moPenaltyLossValue,
    moPenaltySelectedValue,
    moRequiredCount,
    passiveMoModifiers,
    pendingMoForAttack,
    progressMo,
    progressMoById,
    recordMoHistory,
    resolveNonTaskMo,
    revealMo,
    selectAttackMo,
    selectDefenseMo,
    unfulfilledMoObligations,
    unitRepairCost,
  });
}

module.exports = { createMoSystem };
