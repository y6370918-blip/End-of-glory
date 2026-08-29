"use strict";

function createFrontSystem(api) {
  const { log } = api;
  const RUSSIAN_EAST_MAINTENANCE = [1, 1, 2, 3, 4, 4, 4, 3, 3, 3];
  const RUSSIAN_AH_MAINTENANCE = [6, 6, 5, 4, 4, 4, 3, 3, 2, 2];
  const TURKISH_MAINTENANCE = [1, 1, 1.5, 1.5, 2, 2, 1.5, 1.5, 1, 0];
  function frontVpValue(track, position) {
    if (track === "russian")
      return [2, 5, 7, 9].filter((threshold) => position >= threshold).length;
    return -[3, 6, 8].filter((threshold) => position >= threshold).length;
  }

  function clampVp(value) {
    return Math.max(0, Math.min(40, Number(value) || 0));
  }

  function adjustVp(state, amount) {
    const previous = clampVp(state.vp);
    state.vp = clampVp(previous + (Number(amount) || 0));
    return state.vp - previous;
  }

  function frontMovementLocked(state, track) {
    if (track === "turkish" && state.turn_flags.turkish_front_locked === state.turn)
      return true;
    return Object.keys(state.events || {}).some((event) => {
      if (api.data.events[event]?.lock_front === track)
        return true;
      const card = api.data.cards.find((candidate) => candidate.event === event);
      if (!card)
        return false;
      const spec = api.cardSpecById[card.id];
      const rule = api.ruleModifier(card);
      return spec?.combat?.lock_front === track || rule?.lock_front === track;
    });
  }

  function moveFront(state, track, amount, reason = "front movement") {
    if (frontMovementLocked(state, track)) {
      log(state, `${track} front cannot move: ${reason}.`);
      return state.fronts[track];
    }
    const previous = state.fronts[track];
    const raw = previous + amount;
    const next = Math.max(0, Math.min(9, raw));
    let vp = frontVpValue(track, next) - frontVpValue(track, previous);
    if (raw < 0) vp += -raw * (track === "russian" ? -1 : 1);
    state.fronts[track] = next;
    vp = adjustVp(state, vp);
    log(
      state,
      `${track} front ${previous} -> ${next}${vp ? ` (${vp > 0 ? "+" : ""}${vp} VP)` : ""}: ${reason}.`,
    );
    if (track === "turkish" && previous < 2 && next >= 2 && state.fronts.russian < 2)
      moveFront(state, "russian", -1, "Turkish front reached position 2");
    return next;
  }

  

  function applyFrontEndTurnEffects(state) {
      const usageKey = `front_end:${state.turn}`;
      if (state.usage_limits[usageKey])
          return;
      state.usage_limits[usageKey] = 1;
      if (api.turkishFrontActive(state) &&
          state.fronts.turkish >= 5 &&
          state.fronts.russian < 4 &&
          state.fronts.turkish < 9)
          moveFront(state, "turkish", 1, "end-turn Russian-front weakness");
      if (api.turkishFrontActive(state) && state.fronts.turkish >= 9) {
          state.rp.ap.br = (state.rp.ap.br || 0) + 1;
          api.log(state, "Turkish collapse: AP gains 1 BR:RP.");
      }
  }

  function frontEndSrFactions(state) {
      const factions = [];
      if (state.fronts.russian >= 6 &&
          !state.usage_limits[`front_sr:${state.turn}:${api.CP}`])
          factions.push(api.CP);
      if (api.turkishFrontActive(state) &&
          state.fronts.turkish >= 4 &&
          !state.usage_limits[`front_sr:${state.turn}:${api.AP}`])
          factions.push(api.AP);
      return factions;
  }

  function beginFrontEndSr(state) {
      const queue = frontEndSrFactions(state);
      if (!queue.length)
          return false;
      state.sr = {
          card: null,
          remaining: 1,
          used_units: [],
          selected_unit: null,
          source: "front_end",
          queue,
          index: 0,
      };
      api.setActiveFaction(state, queue[0]);
      state.state = "sr";
      state.phase = "战线战略调动";
      api.log(state, `${api.factionRole(state.active)} 获得战线轨的 1 点即时 SR。`);
      return true;
  }

  function finishFrontEndSr(state) {
      const faction = state.sr.queue[state.sr.index];
      state.usage_limits[`front_sr:${state.turn}:${faction}`] = 1;
      state.sr.index += 1;
      if (state.sr.index < state.sr.queue.length) {
          api.setActiveFaction(state, state.sr.queue[state.sr.index]);
          state.sr.remaining = 1;
          state.sr.used_units = [];
          state.sr.selected_unit = null;
          api.log(state, `${api.factionRole(state.active)} 获得战线轨的 1 点即时 SR。`);
          return;
      }
      state.sr = null;
      api.beginDrawPhase(state);
  }

  function frontMaintenanceRates(pool) {
      if (pool === "east")
          return { east: 1, ge: 1, ah: 0.5 };
      if (pool === "ah")
          return { ah: 1, ge: 2, east: 2 };
      return { br: 1, us: 1 };
  }

  function frontPaymentIncrement(rate) {
      return rate < 1 ? 1 : 0.5;
  }

  function russianMaintenanceCosts(state) {
      const treaty = api.activeRule(state, "brest_litovsk");
      const discount = treaty?.russian_maintenance_discount || 0;
      return {
          east: Math.max(0, RUSSIAN_EAST_MAINTENANCE[state.fronts.russian] - discount),
          ah: RUSSIAN_AH_MAINTENANCE[state.fronts.russian],
      };
  }

  function turkishMaintenanceCost(state) {
      return api.turkishFrontActive(state)
          ? TURKISH_MAINTENANCE[state.fronts.turkish]
          : 0;
  }

  function burgfriedenMaintenanceCredit(state) {
      const rule = api.activeRule(state, "burgfrieden");
      if (!rule || state.events[api.cardById[rule.canceled_by_card]?.event])
          return 0;
      return rule.front_maintenance_credit?.amount || 0;
  }

  function allocateEquivalent(sources, maintenanceNeed, advanceNeed) {
      const maintenance = {};
      const advance = {};
      let remainingMaintenance = maintenanceNeed;
      let remainingAdvance = advanceNeed;
      for (const source of sources) {
          let amount = Math.max(0, source.amount || 0);
          if (remainingMaintenance > 1e-9 && amount > 1e-9) {
              const value = Math.min(remainingMaintenance, amount * source.rate);
              const spent = value / source.rate;
              maintenance[source.key] = (maintenance[source.key] || 0) + spent;
              amount -= spent;
              remainingMaintenance -= value;
          }
          if (remainingAdvance > 1e-9 && amount > 1e-9) {
              const value = Math.min(remainingAdvance, amount * source.rate);
              const spent = value / source.rate;
              advance[source.key] = (advance[source.key] || 0) + spent;
              amount -= spent;
              remainingAdvance -= value;
          }
      }
      if (remainingMaintenance > 1e-9 || remainingAdvance > 1e-9)
          return null;
      return { maintenance, advance };
  }

  function addRpAmounts(...groups) {
      const result = {};
      for (const group of groups)
          for (const [key, amount] of Object.entries(group || {}))
              result[key] = (result[key] || 0) + amount;
      return result;
  }

  function frontMoCommitmentPlan(state, faction, id) {
      const nation = faction === api.CP ? "ge" : "br";
      if (!(state.mo.current[nation] || []).includes(id) || api.moIsResolved(state, nation, id))
          return null;
      const mo = api.moDefinition(state, id);
      if (!api.moAvailable(state, mo) || mo?.requirement !== "advance_front")
          return null;
      if ((mo.front === "turkish" && !api.turkishFrontActive(state)) ||
          api.frontMovementLocked(state, mo.front))
          return null;
      const spec = frontInvestmentSpec(state, mo.front, faction);
      if (!spec || spec.mo !== id)
          return null;
      const storage = state.front_storage[spec.track] || 0;
      const stepCredit = spec.creditKey ? state.usage_limits[spec.creditKey] || 0 : 0;
      const advanceNeed = Math.max(0, spec.cost - storage - stepCredit);

      if (spec.track === "russian") {
          const costs = russianMaintenanceCosts(state);
          const rp = { ...(state.rp[faction] || {}) };
          const maintenanceCredit = Math.min(burgfriedenMaintenanceCredit(state), costs.east);
          const eastMaintenance = costs.east - maintenanceCredit;

          // AH maintenance is reserved first. Only AH remaining after that
          // obligation may be converted at 2:1 to an explicit EAST cost.
          const ahForAh = Math.min(rp.ah || 0, costs.ah);
          const ahDeficit = costs.ah - ahForAh;
          const geForAh = ahDeficit / 2;
          if ((rp.ge || 0) + 1e-9 < geForAh)
              return null;
          rp.ah = (rp.ah || 0) - ahForAh;
          rp.ge = (rp.ge || 0) - geForAh;

          const allocation = allocateEquivalent([
              { key: "east", rate: 1, amount: rp.east || 0 },
              { key: "ah", rate: 0.5, amount: rp.ah || 0 },
              { key: "ge", rate: 1, amount: rp.ge || 0 },
          ], eastMaintenance, advanceNeed);
          if (!allocation)
              return null;
          const ahMaintenanceRp = addRpAmounts(
              ahForAh ? { ah: ahForAh } : {},
              geForAh ? { ge: geForAh } : {},
          );
          const reserved = addRpAmounts(
              allocation.maintenance,
              ahMaintenanceRp,
              allocation.advance,
          );
          return {
              turn: state.turn,
              faction,
              nation,
              id,
              track: spec.track,
              maintenance: [
                  { track: "russian", pool: "east", rp: allocation.maintenance,
                    credit: maintenanceCredit, equivalent: costs.east },
                  { track: "russian", pool: "ah", rp: ahMaintenanceRp,
                    credit: 0, equivalent: costs.ah },
              ],
              advance: { rp: allocation.advance, cost: spec.cost, storage, step_credit: stepCredit },
              reserved_rp: reserved,
              usage_key: spec.usageKey,
              used: spec.used,
              processed: false,
          };
      }

      const maintenanceNeed = turkishMaintenanceCost(state);
      const rp = state.rp[faction] || {};
      const allocation = allocateEquivalent([
          { key: "br", rate: 1, amount: rp.br || 0 },
          { key: "us", rate: 1, amount: rp.us || 0 },
      ], maintenanceNeed, advanceNeed);
      if (!allocation)
          return null;
      return {
          turn: state.turn,
          faction,
          nation,
          id,
          track: spec.track,
          maintenance: [
              { track: "turkish", pool: "ne", rp: allocation.maintenance,
                credit: 0, equivalent: maintenanceNeed },
          ],
          advance: { rp: allocation.advance, cost: spec.cost, storage, step_credit: stepCredit },
          reserved_rp: addRpAmounts(allocation.maintenance, allocation.advance),
          usage_key: spec.usageKey,
          used: spec.used,
          processed: false,
      };
  }

  function frontMoCommitmentKey(entry) {
      return `${entry.nation}:${entry.id}`;
  }

  function frontMoCommitmentCandidates(state, faction) {
      const obligation = frontMoObligation(state, faction);
      if (!obligation)
          return [];
      return frontMoCommitmentPlan(state, faction, obligation.id) ? [obligation.id] : [];
  }

  function frontMoReservedRp(state, faction, key) {
      return Object.values(state.mo.front_commitments || {})
          .filter((entry) => entry?.turn === state.turn && entry.faction === faction && !entry.processed)
          .reduce((sum, entry) => sum + (entry.reserved_rp?.[key] || 0), 0);
  }

  function finishFrontMoCommitmentReview(state) {
      delete state.mo.front_commitment_review;
      if (!api.beginMoPenaltyResolution(state))
          api.beginAttrition(state);
  }

  function advanceFrontMoCommitmentReview(state) {
      const review = state.mo.front_commitment_review;
      if (!review)
          return finishFrontMoCommitmentReview(state);
      review.index += 1;
      if (review.index >= review.queue.length)
          return finishFrontMoCommitmentReview(state);
      const next = review.queue[review.index];
      api.setActiveFaction(state, next.faction);
      state.state = "front_mo_commit";
      state.phase = "战线MO承诺";
  }

  function beginFrontMoCommitmentReview(state) {
      completeSatisfiedFrontMos(state, api.CP);
      completeSatisfiedFrontMos(state, api.AP);
      const queue = [api.CP, api.AP].flatMap((faction) => {
          const obligation = frontMoObligation(state, faction);
          if (!obligation || !frontMoCommitmentPlan(state, faction, obligation.id))
              return [];
          return [{ faction, nation: obligation.nation, id: obligation.id }];
      });
      if (!queue.length)
          return false;
      state.mo.front_commitment_review = { queue, index: 0 };
      api.setActiveFaction(state, queue[0].faction);
      state.state = "front_mo_commit";
      state.phase = "战线MO承诺";
      return true;
  }

  function commitFrontMo(state, id) {
      const review = state.mo.front_commitment_review;
      const current = review?.queue?.[review.index];
      if (!current || current.faction !== state.active || current.id !== id)
          throw new Error("This front MO cannot be committed now");
      const plan = frontMoCommitmentPlan(state, current.faction, id);
      if (!plan)
          throw new Error("Insufficient RP to maintain and advance the front");
      state.mo.front_commitments ||= {};
      state.mo.front_commitments[frontMoCommitmentKey(plan)] = plan;
      advanceFrontMoCommitmentReview(state);
  }

  function declineFrontMo(state) {
      const review = state.mo.front_commitment_review;
      if (!review?.queue?.[review.index] || review.queue[review.index].faction !== state.active)
          throw new Error("No front MO commitment is pending");
      advanceFrontMoCommitmentReview(state);
  }

  function unitFrontRpKeys(unit) {
      if (["component-109", "component-110"].includes(unit.piece))
          return ["east"];
      const combined = api.pieceById[unit.piece]?.combined_nations;
      if (Array.isArray(combined) && combined.length)
          return combined.slice();
      return api.replacementKeys(unit);
  }

  function frontMaintenanceChoices(state, pending = state.pending_event) {
      const obligation = pending?.obligations?.[pending.index];
      if (!obligation)
          return [];
      const rates = frontMaintenanceRates(obligation.pool);
      const result = [];
      const nativeKey = obligation.pool === "east"
          ? "east"
          : obligation.pool === "ah"
              ? "ah"
              : null;
      for (const [key, rate] of Object.entries(rates)) {
          if (key === nativeKey) continue;
          const amount = frontPaymentIncrement(rate);
          if ((state.rp[obligation.faction][key] || 0) >= amount &&
              rate * amount <= obligation.remaining + 1e-9)
              result.push({
                  id: `pay:${key}`,
                  label: `支付 ${amount} ${key.toUpperCase()}:RP（满足 ${rate * amount} ${obligation.pool.toUpperCase()}:RP）`,
              });
      }
      return result;
  }

  function applyAutomaticFrontMaintenancePayment(state, pending, obligation) {
      if (!obligation || obligation.automatic_payment_done) return;
      if (pending.credit?.remaining > 0 && obligation.remaining > 0) {
          const paid = Math.min(pending.credit.remaining, obligation.remaining);
          pending.credit.remaining -= paid;
          obligation.remaining = Math.max(0, obligation.remaining - paid);
      }
      const nativeKey = obligation.pool === "east"
          ? "east"
          : obligation.pool === "ah"
              ? "ah"
              : null;
      if (nativeKey && obligation.remaining > 0) {
          const paid = Math.min(
              state.rp[obligation.faction][nativeKey] || 0,
              obligation.remaining,
          );
          state.rp[obligation.faction][nativeKey] -= paid;
          obligation.remaining = Math.max(0, obligation.remaining - paid);
      }
      if (obligation.pool === "ne" && obligation.remaining > 0) {
          // The Turkish front has no separate NE pool.  Its printed
          // maintenance is paid automatically from BR first, then A/US.
          for (const key of ["br", "us"]) {
              if (obligation.remaining <= 1e-9) break;
              const paid = Math.min(
                  state.rp[obligation.faction][key] || 0,
                  obligation.remaining,
              );
              if (paid > 0)
                  state.rp[obligation.faction][key] -= paid;
              obligation.remaining = Math.max(0, obligation.remaining - paid);
          }
      }
      obligation.automatic_payment_done = true;
  }

  function spendCommittedRp(state, commitment, payments) {
      for (const [key, amount] of Object.entries(payments || {})) {
          if ((state.rp[commitment.faction][key] || 0) + 1e-9 < amount)
              throw new Error(`Reserved ${key.toUpperCase()}:RP is no longer available`);
          state.rp[commitment.faction][key] -= amount;
          commitment.reserved_rp[key] = Math.max(0,
              (commitment.reserved_rp[key] || 0) - amount);
      }
  }

  function applyCommittedFrontMaintenance(state, pending) {
      for (const commitment of Object.values(state.mo.front_commitments || {})) {
          if (!commitment || commitment.turn !== state.turn || commitment.processed ||
              commitment.maintenance_applied)
              continue;
          for (const payment of commitment.maintenance || []) {
              const obligation = pending.obligations.find((entry) =>
                  entry.track === payment.track && entry.pool === payment.pool &&
                  entry.faction === commitment.faction);
              if (!obligation)
                  continue;
              spendCommittedRp(state, commitment, payment.rp);
              if (payment.credit > 0) {
                  if ((pending.credit?.remaining || 0) + 1e-9 < payment.credit)
                      throw new Error("Reserved front-maintenance credit is no longer available");
                  pending.credit.remaining -= payment.credit;
              }
              obligation.remaining = Math.max(0, obligation.remaining - payment.equivalent);
              obligation.automatic_payment_done = true;
          }
          commitment.maintenance_applied = true;
      }
  }

  function resolveCommittedFrontMos(state) {
      const commitments = Object.values(state.mo.front_commitments || {})
          .filter((entry) => entry?.turn === state.turn && !entry.processed);
      for (const commitment of commitments) {
          const definition = api.moDefinition(state, commitment.id);
          const invalidated = api.moIsResolved(state, commitment.nation, commitment.id) ||
              !api.moAvailable(state, definition) ||
              api.frontMovementLocked(state, commitment.track) ||
              state.fronts[commitment.track] >= 9 ||
              (definition?.collapse_position != null &&
                  state.fronts[commitment.track] >= definition.collapse_position) ||
              (definition?.unless_event && state.events[definition.unless_event]);
          if (invalidated) {
              commitment.processed = true;
              commitment.waived = true;
              commitment.reserved_rp = {};
              if (!api.moIsResolved(state, commitment.nation, commitment.id))
                  api.resolveNonTaskMo(state, commitment.nation, commitment.id, "waived");
              api.log(state, `${commitment.nation.toUpperCase()} 战线MO已失效，未扣除推进费用。`);
              continue;
          }
          spendCommittedRp(state, commitment, commitment.advance?.rp);
          const storage = commitment.advance?.storage || 0;
          if (storage > 0)
              state.front_storage[commitment.track] = Math.max(0,
                  (state.front_storage[commitment.track] || 0) - storage);
          const stepCredit = commitment.advance?.step_credit || 0;
          const creditKey = commitment.track === "turkish"
              ? `turkish_front_steps:${state.turn}`
              : null;
          if (creditKey && stepCredit > 0)
              state.usage_limits[creditKey] = Math.max(0,
                  (state.usage_limits[creditKey] || 0) - stepCredit);
          const previous = state.fronts[commitment.track];
          const advanced = moveFront(state, commitment.track, 1, "committed front MO");
          if (advanced !== previous + 1)
              throw new Error("Committed front MO did not advance its front");
          state.usage_limits[commitment.usage_key] = commitment.used + 1;
          if (commitment.track === "turkish")
              state.turn_flags.turkish_front_advanced = state.turn;
          api.completeMo(state, commitment.nation, commitment.id);
          commitment.processed = true;
          api.log(state, `${commitment.nation.toUpperCase()} 战线MO已自动支付并推进战线。`);
      }
  }

  function frontMaintenanceReductionCandidates(state, pending = state.pending_event) {
      const obligation = pending?.obligations?.[pending.index];
      if (!obligation)
          return [];
      const rates = frontMaintenanceRates(obligation.pool);
      return [
          ...state.units.filter((unit) => unit.faction === obligation.faction),
          ...state.reserves[obligation.faction],
      ]
          .filter((unit) => api.isCombatUnit(unit) && !unit.reduced)
          .filter((unit) => unitFrontRpKeys(unit).some((key) => rates[key]))
          .map((unit) => unit.id);
  }

  function advanceFrontMaintenance(state, pending = state.pending_event) {
      while (pending.index < pending.obligations.length) {
          const obligation = pending.obligations[pending.index];
          applyAutomaticFrontMaintenancePayment(state, pending, obligation);
          if (obligation.remaining <= 1e-9) {
              obligation.remaining = 0;
              pending.index += 1;
              continue;
          }
          if (frontMaintenanceChoices(state, pending).length ||
              frontMaintenanceLossCandidates(state, pending).length)
              return true;
          api.log(state, `${obligation.track} front: ${obligation.remaining} ${obligation.pool.toUpperCase()}:RP maintenance could not be paid without eliminating a unit.`);
          pending.index += 1;
      }
      state.usage_limits[`front_maintenance:${state.turn}`] = 1;
      state.pending_event = null;
      state.state = "replacement";
      api.setActiveFaction(state, api.AP);
      state.replacement_active = api.AP;
      resolveCommittedFrontMos(state);
      api.continueReplacement(state);
      return false;
  }

  function beginFrontMaintenance(state) {
      if (state.usage_limits[`front_maintenance:${state.turn}`])
          return false;
      const russian = russianMaintenanceCosts(state);
      state.pending_event = {
          kind: "front_maintenance",
          owner: api.CP,
          index: 0,
          obligations: [
              {
                  faction: api.CP,
                  track: "russian",
                  pool: "east",
                  remaining: russian.east,
                  automatic_payment_done: false,
              },
              {
                  faction: api.CP,
                  track: "russian",
                  pool: "ah",
                  remaining: russian.ah,
                  automatic_payment_done: false,
              },
              ...(api.turkishFrontActive(state)
                  ? [
                      {
                          faction: api.AP,
                          track: "turkish",
                          pool: "ne",
                          remaining: turkishMaintenanceCost(state),
                          automatic_payment_done: false,
                      },
                  ]
                  : []),
          ].filter((obligation) => obligation.remaining > 0),
          credit: burgfriedenMaintenanceCredit(state)
              ? { remaining: burgfriedenMaintenanceCredit(state), source: 704 }
              : null,
      };
      applyCommittedFrontMaintenance(state, state.pending_event);
      state.phase = "战线消耗";
      api.enterEventFlow(state);
      api.setActiveFaction(state, api.CP);
      advanceFrontMaintenance(state);
      if (state.pending_event?.kind === "front_maintenance") {
          const obligation = state.pending_event.obligations[state.pending_event.index];
          state.pending_event.owner = obligation.faction;
          api.setActiveFaction(state, obligation.faction);
          return true;
      }
      return false;
  }

  function frontMaintenanceEventChoices(state, pending = state.pending_event) {
      const obligation = pending?.obligations?.[pending.index];
      if (!obligation)
          return [];
      return frontMaintenanceChoices(state, pending);
  }

  function frontMaintenanceLossCandidates(state, pending = state.pending_event) {
      const obligation = pending?.obligations?.[pending.index];
      if (!obligation)
          return [];
      // Unit reductions are the last resort. Every legal RP payment or
      // conversion must be exhausted first.
      if (frontMaintenanceChoices(state, pending).length)
          return [];
      const rates = frontMaintenanceRates(obligation.pool);
      const choices = [];
      for (const id of frontMaintenanceReductionCandidates(state, pending)) {
          const unit = state.units.find((candidate) => candidate.id === id) ||
              state.reserves[obligation.faction].find((candidate) => candidate.id === id);
          for (const key of unitFrontRpKeys(unit).filter((candidate) => rates[candidate]))
              if (rates[key] <= obligation.remaining + 1e-9)
                  choices.push(`${id}:${key}`);
      }
      return choices;
  }

  function takeFrontMaintenanceLoss(state, token) {
      const pending = state.pending_event;
      const obligation = pending?.obligations?.[pending.index];
      if (!obligation || !frontMaintenanceLossCandidates(state, pending).includes(token))
          throw new Error("Illegal front maintenance reduction");
      const [id, key] = String(token).split(":");
      const unit = state.units.find((candidate) => candidate.id === id) ||
          state.reserves[obligation.faction].find((candidate) => candidate.id === id);
      const rates = frontMaintenanceRates(obligation.pool);
      unit.reduced = true;
      obligation.remaining = Math.max(0, obligation.remaining - rates[key]);
      advanceFrontMaintenance(state, pending);
      if (state.pending_event?.kind === "front_maintenance") {
          const next = state.pending_event.obligations[state.pending_event.index];
          state.pending_event.owner = next.faction;
          api.setActiveFaction(state, next.faction);
      }
  }

  function chooseFrontMaintenance(state, id) {
      const pending = state.pending_event;
      const obligation = pending?.obligations?.[pending.index];
      if (!obligation)
          throw new Error("No front maintenance obligation");
      const [kind, value, selectedKey] = String(id).split(":");
      const rates = frontMaintenanceRates(obligation.pool);
      if (kind === "credit") {
          if (value !== "burgfrieden" ||
              !(pending.credit?.remaining > 0))
              throw new Error("Illegal front-maintenance credit");
          const paid = Math.min(1, obligation.remaining, pending.credit.remaining);
          pending.credit.remaining -= paid;
          obligation.remaining = Math.max(0, obligation.remaining - paid);
      }
      else if (kind === "pay") {
          const key = value;
          const amount = frontPaymentIncrement(rates[key]);
          if (!rates[key] ||
              (state.rp[obligation.faction][key] || 0) < amount ||
              rates[key] * amount > obligation.remaining + 1e-9)
              throw new Error("Illegal front maintenance payment");
          state.rp[obligation.faction][key] -= amount;
          obligation.remaining = Math.max(0, obligation.remaining - rates[key] * amount);
      }
      else if (kind === "reduce") {
          takeFrontMaintenanceLoss(state, `${value}:${selectedKey}`);
          return;
      }
      else
          throw new Error("Invalid front maintenance choice");
      advanceFrontMaintenance(state, pending);
      if (state.pending_event?.kind === "front_maintenance") {
          const next = state.pending_event.obligations[state.pending_event.index];
          state.pending_event.owner = next.faction;
          api.setActiveFaction(state, next.faction);
      }
  }

  function frontMoObligation(state, faction, track = null) {
      const nation = faction === api.CP ? "ge" : "br";
      for (const id of state.mo.current[nation] || []) {
          if (api.moIsResolved(state, nation, id))
              continue;
          const mo = api.moDefinition(state, id);
          if (!api.moAvailable(state, mo))
              continue;
          if (mo?.front === "turkish" && !api.turkishFrontActive(state))
              continue;
          if (mo?.requirement !== "advance_front" || (track && mo.front !== track))
              continue;
          if ((mo.collapse_position != null &&
              state.fronts[mo.front] >= mo.collapse_position) ||
              (mo.unless_event && state.events[mo.unless_event]))
              continue;
          return { id, nation, ...mo };
      }
      return null;
  }

  function completeSatisfiedFrontMos(state, faction) {
      const nation = faction === api.CP ? "ge" : "br";
      for (const id of state.mo.current[nation] || []) {
          const mo = api.moDefinition(state, id);
          if (api.moAvailable(state, mo) &&
              (mo.front !== "turkish" || api.turkishFrontActive(state)) &&
              mo?.requirement === "advance_front" &&
              ((mo.collapse_position != null &&
                  state.fronts[mo.front] >= mo.collapse_position) ||
                  (mo.unless_event && state.events[mo.unless_event])))
              api.resolveNonTaskMo(state, nation, id, "waived");
      }
  }

  function frontInvestmentSpec(state, track, faction = state.active) {
      if (track === "turkish" && !api.turkishFrontActive(state))
          return null;
      if ((track === "russian" && faction !== api.CP) ||
          (track === "turkish" && faction !== api.AP))
          return null;
      const usageKey = `front:${state.turn}:${faction}:${track}`;
      const used = state.usage_limits[usageKey] || 0;
      const attemptKey = `front_attempt:${state.turn}:${faction}:${track}`;
      const attempts = state.usage_limits[attemptKey] || 0;
      const allenby = faction === api.AP && track === "turkish" ? api.activeRule(state, "allenby") : null;
      const hindenburg = faction === api.CP && track === "russian"
          ? api.activeRule(state, "hindenburg_ludendorff")
          : null;
      const maximum = allenby || hindenburg ? 2 : 1;
      if (used >= maximum || attempts >= maximum || state.fronts[track] >= 9)
          return null;
      const extra = track === "turkish" &&
          state.turn_flags.turkish_front_cost_turn === state.turn
          ? state.turn_flags.turkish_front_cost_increase || 0
          : 0;
      let cost = used === 0
          ? (track === "russian" ? 4.5 : 3) + extra
          : track === "russian"
              ? hindenburg.extra_russian_front_cost
              : 1 + extra;
      const mo = frontMoObligation(state, faction, track);
      if (used === 0 && mo?.investment_discount)
          cost -= mo.investment_discount;
      return {
          track,
          faction,
          usageKey,
          attemptKey,
          attempts,
          used,
          cost,
          rates: track === "russian"
              ? { east: 1, ge: 1, ah: 0.5 }
              : used > 0 && allenby?.extra_front_step_rp?.costs
                  ? Object.fromEntries(Object.entries(allenby.extra_front_step_rp.costs)
                      .map(([nation, amount]) => [nation, 1 / amount]))
                  : { br: 1, us: 1 },
          creditKey: track === "turkish" ? `turkish_front_steps:${state.turn}` : null,
          mo: mo?.id || null,
          allow_unit_payment: Boolean(used > 0 && hindenburg?.allow_unit_payment),
      };
  }

  function frontPaymentUnitEntries(state, spec) {
      if (!spec?.allow_unit_payment || spec.faction !== api.CP)
          return [];
      return [
          ...state.units.map((unit) => ({ unit, zone: "map" })),
          ...(state.reserves.cp || []).map((unit) => ({ unit, zone: "reserve" })),
      ]
          .filter(({ unit }) => unit.faction === api.CP && api.isCombatUnit(unit))
          .map(({ unit, zone }) => {
          const key = api.replacementKey(unit);
          const rate = spec.rates[key] || 0;
          const cost = unit.reduced
              ? unit.type === "army" ? 2 : 1
              : api.unitRepairCost(unit);
          return { unit, zone, key, credit: rate * cost };
      })
          .filter((entry) => entry.credit > 0);
  }

  function frontUnitPaymentAvailable(state, spec) {
      return frontPaymentUnitEntries(state, spec)
          .reduce((sum, entry) => sum + entry.credit, 0);
  }

  function frontPaymentCanReach(state, pending, excludedUnit = null, addedCredit = 0) {
      const remaining = pending.cost - pending.paid - addedCredit;
      if (remaining < -1e-9)
          return false;
      const target = Math.round(Math.max(0, remaining) * 2);
      const cash = Math.floor(Object.entries(pending.rates).reduce((sum, [key, rate]) => sum +
          (state.rp[pending.faction][key] || 0) * rate, 0) * 2 + 1e-9);
      const reachable = new Set([0]);
      for (const entry of frontPaymentUnitEntries(state, pending)) {
          if (entry.unit.id === excludedUnit)
              continue;
          const value = Math.round(entry.credit * 2);
          for (const subtotal of [...reachable])
              if (subtotal + value <= target)
                  reachable.add(subtotal + value);
      }
      return [...reachable].some((subtotal) => target - subtotal <= cash);
  }

  function frontInvestmentCanComplete(state, spec) {
      const storage = state.front_storage[spec.track] || 0;
      const credit = spec.creditKey ? state.usage_limits[spec.creditKey] || 0 : 0;
      return frontPaymentCanReach(state, {
          ...spec,
          paid: storage + credit,
      });
  }

  function frontInvestmentAvailable(state, spec) {
      let result = state.front_storage[spec.track] || 0;
      for (const [key, rate] of Object.entries(spec.rates))
          result += (state.rp[spec.faction][key] || 0) * rate;
      if (spec.creditKey)
          result += state.usage_limits[spec.creditKey] || 0;
      result += frontUnitPaymentAvailable(state, spec);
      return result;
  }

  function frontMoLossCandidates(state, faction = state.active) {
      const obligation = frontMoObligation(state, faction);
      if (!obligation)
          return [];
      const spec = frontInvestmentSpec(state, obligation.front, faction);
      if (!spec || frontInvestmentAvailable(state, spec) >= spec.cost - 1e-9)
          return [];
      return [...state.units, ...(state.reserves[faction] || [])]
          .filter((unit) => unit.faction === faction && api.isCombatUnit(unit) && !unit.reduced)
          .filter((unit) => Object.hasOwn(spec.rates, api.replacementKey(unit)))
          .map((unit) => unit.id);
  }

  function takeFrontMoLoss(state, id) {
      const candidates = frontMoLossCandidates(state);
      if (!candidates.includes(id))
          throw new Error("Illegal mandatory-front RP loss");
      const unit = state.units.find((candidate) => candidate.id === id) ||
          state.reserves[state.active].find((candidate) => candidate.id === id);
      const key = api.replacementKey(unit);
      unit.reduced = true;
      state.rp[state.active][key] = (state.rp[state.active][key] || 0) + 1;
      api.log(state, `${api.pieceById[unit.piece]?.name || unit.id} 减损，获得 1 ${key.toUpperCase()}:RP 以完成战线 MO。`);
  }

  function frontInvestmentPaymentChoices(state, pending = state.pending_event) {
      if (pending?.replacement_choice)
          return pending.replacement_choice.options.map((id) => ({
              id: `replacement:${id}`,
              label: `以 ${api.pieceById[(state.reserves.cp || []).find((unit) => unit.id === id)?.piece]?.name || id} 替代被消灭的LCU`,
          }));
      const choices = [];
      const remaining = pending.cost - pending.paid;
      for (const [key, rate] of Object.entries(pending.rates)) {
          if (pending.track === "russian" && key === "east") continue;
          const amount = frontPaymentIncrement(rate);
          const credit = amount * rate;
          if ((state.rp[pending.faction][key] || 0) < amount ||
              credit > remaining + 1e-9)
              continue;
          const availableAfter = Object.entries(pending.rates).reduce((sum, [candidate, candidateRate]) => sum +
              Math.max(0, (state.rp[pending.faction][candidate] || 0) -
                  (candidate === key ? amount : 0)) *
                  candidateRate, 0);
          if (pending.paid + credit > 1 + 1e-9 &&
              pending.paid + credit + availableAfter < pending.cost - 1e-9)
              continue;
          choices.push({
              id: `pay:${key}`,
              label: `投入 ${amount} ${key.toUpperCase()}:RP（${credit} ${pending.pool}:RP）`,
          });
      }
      if (!pending.mo && pending.paid > 0 && pending.paid <= 1 + 1e-9)
          choices.push({
              id: "store",
              label: `保留 ${pending.paid} ${pending.pool}:RP，稍后继续`,
          });
      return choices;
  }

  function frontUnitPaymentCandidates(state, pending = state.pending_event) {
      if (pending?.kind !== "front_investment" ||
          !pending.allow_unit_payment || pending.replacement_choice)
          return [];
      const remaining = pending.cost - pending.paid;
      const entries = frontPaymentUnitEntries(state, pending);
      return entries
          .filter((entry) => entry.credit <= remaining + 1e-9)
          .filter((entry) => frontPaymentCanReach(state, pending, entry.unit.id, entry.credit))
          .map((entry) => entry.unit.id);
  }

  function beginFrontInvestment(state, option) {
      const spec = frontInvestmentSpec(state, option.track, state.active);
      if (!spec)
          throw new Error("Front investment is no longer legal");
      const storage = state.front_storage[spec.track] || 0;
      const credit = spec.creditKey ? state.usage_limits[spec.creditKey] || 0 : 0;
      state.usage_limits[spec.attemptKey] = spec.attempts + 1;
      state.front_storage[spec.track] = 0;
      if (spec.creditKey)
          state.usage_limits[spec.creditKey] = 0;
      state.pending_event = {
          kind: "front_investment",
          owner: spec.faction,
          faction: spec.faction,
          track: spec.track,
          pool: spec.track === "russian" ? "EAST" : "NE",
          cost: spec.cost,
          paid: storage + credit,
          rates: spec.rates,
          usage_key: spec.usageKey,
          used: spec.used,
          mo: spec.mo,
          allow_unit_payment: spec.allow_unit_payment,
          replacement_choice: null,
          automatic_payment_done: false,
      };
      const pending = state.pending_event;
      if (pending.track === "russian" && pending.paid < pending.cost - 1e-9) {
          const remaining = pending.cost - pending.paid;
          const canFinish = spec.mo || frontInvestmentCanComplete(state, spec);
          const storageRoom = Math.max(0, 1 - pending.paid);
          const paymentLimit = canFinish ? remaining : Math.min(remaining, storageRoom);
          const paid = Math.min(state.rp[pending.faction].east || 0, paymentLimit);
          state.rp[pending.faction].east -= paid;
          pending.paid += paid;
      }
      pending.automatic_payment_done = true;
      state.phase = "战线投入";
      api.enterEventFlow(state);
      if (pending.paid >= pending.cost - 1e-9)
          finishFrontInvestment(state, pending);
  }

  function finishFrontInvestment(state, pending) {
      moveFront(state, pending.track, 1, "replacement investment");
      state.usage_limits[pending.usage_key] = pending.used + 1;
      if (pending.track === "turkish")
          state.turn_flags.turkish_front_advanced = state.turn;
      if (pending.mo) {
          const nation = pending.faction === api.CP ? "ge" : "br";
          api.completeMo(state, nation, pending.mo);
      }
      api.log(state, `${pending.track} front advanced for ${pending.cost} ${pending.pool}:RP.`);
      state.pending_event = null;
      state.phase = "补员/升级";
      state.state = "replacement";
      api.setActiveFaction(state, pending.faction);
      state.replacement_active = pending.faction;
  }

  function chooseFrontInvestment(state, id) {
      const pending = state.pending_event;
      if (pending?.kind !== "front_investment")
          throw new Error("No front investment is pending");
      if (pending.replacement_choice) {
          const [kind, replacementId] = String(id).split(":");
          if (kind !== "replacement" ||
              !pending.replacement_choice.options.includes(replacementId))
              throw new Error("Illegal front-payment replacement corps");
          const index = state.reserves.cp.findIndex((unit) => unit.id === replacementId);
          if (index < 0)
              throw new Error("Front-payment replacement corps is no longer available");
          const [replacement] = state.reserves.cp.splice(index, 1);
          api.hydrateUnit(replacement);
          replacement.location = pending.replacement_choice.location;
          replacement.moved = true;
          replacement.attacked = false;
          state.units.push(replacement);
          api.log(state, `${api.pieceById[pending.replacement_choice.army_piece]?.name || pending.replacement_choice.army}由${api.pieceById[replacement.piece]?.name || replacement.id}替代。`);
          pending.replacement_choice = null;
          if (pending.paid >= pending.cost - 1e-9)
              finishFrontInvestment(state, pending);
          return;
      }
      if (id === "store") {
          if (pending.mo || pending.paid <= 0 || pending.paid > 1 + 1e-9)
              throw new Error("Only one front RP may be retained");
          state.front_storage[pending.track] = pending.paid;
          state.pending_event = null;
          state.phase = "补员/升级";
          state.state = "replacement";
          api.setActiveFaction(state, pending.faction);
          state.replacement_active = pending.faction;
          return;
      }
      const [kind, key] = String(id).split(":");
      const rate = pending.rates[key];
      const amount = frontPaymentIncrement(rate);
      const credit = amount * rate;
      if (kind !== "pay" ||
          !rate ||
          (state.rp[pending.faction][key] || 0) < amount ||
          pending.paid + credit > pending.cost + 1e-9 ||
          !frontInvestmentPaymentChoices(state, pending).some((choice) => choice.id === id))
          throw new Error("Illegal front investment payment");
      state.rp[pending.faction][key] -= amount;
      pending.paid += credit;
      if (pending.paid >= pending.cost - 1e-9)
          finishFrontInvestment(state, pending);
  }

  function payFrontWithUnit(state, id) {
      const pending = state.pending_event;
      if (pending?.kind !== "front_investment" ||
          !frontUnitPaymentCandidates(state, pending).includes(id))
          throw new Error("Unit cannot pay for this front investment");
      const entry = frontPaymentUnitEntries(state, pending)
          .find((candidate) => candidate.unit.id === id);
      if (!entry)
          throw new Error("Front-payment unit is no longer available");
      const unit = entry.unit;
      pending.paid += entry.credit;
      if (!unit.reduced) {
          unit.reduced = true;
          api.log(state, `${api.pieceById[unit.piece]?.name || id}减损，为俄国战线提供 ${entry.credit} EAST:RP。`);
      }
      else {
          const location = unit.location;
          const replacementOptions = entry.zone === "map" && unit.type === "army"
              ? api.combatReplacementOptions(state, unit).map((candidate) => candidate.id)
              : [];
          const pool = entry.zone === "map" ? state.units : state.reserves.cp;
          const index = pool.findIndex((candidate) => candidate.id === id);
          const [eliminated] = pool.splice(index, 1);
          api.placeEliminatedUnit(state, eliminated, "front_unit_payment");
          api.log(state, `${api.pieceById[unit.piece]?.name || id}被消灭，为俄国战线提供 ${entry.credit} EAST:RP。`);
          if (replacementOptions.length) {
              pending.replacement_choice = {
                  army: id,
                  army_piece: unit.piece,
                  location,
                  options: replacementOptions,
              };
              if (replacementOptions.length === 1) {
                  chooseFrontInvestment(state, `replacement:${replacementOptions[0]}`);
                  return;
              }
          }
      }
      if (!pending.replacement_choice && pending.paid >= pending.cost - 1e-9)
          finishFrontInvestment(state, pending);
  }

  function turkishFrontStepCandidates(state) {
      if (state.active !== api.AP ||
          !api.turkishFrontActive(state) ||
          !api.activeRule(state, "turkish_front_step_payment"))
          return [];
      const rule = api.activeRule(state, "turkish_front_step_payment");
      const usageKey = `front:${state.turn}:ap:turkish`;
      if ((state.usage_limits[usageKey] || 0) >=
          (api.activeRule(state, "allenby") ? 2 : 1))
          return [];
      return state.units
          .filter((unit) => unit.faction === api.AP &&
          rule.nations.includes(unit.nation) &&
          !unit.reduced)
          .map((unit) => unit.id);
  }

  function payTurkishFrontStep(state, id) {
      if (!turkishFrontStepCandidates(state).includes(id))
          throw new Error("Unit cannot pay Turkish-front RP");
      const unit = state.units.find((candidate) => candidate.id === id);
      unit.reduced = true;
      const key = `turkish_front_steps:${state.turn}`;
      state.usage_limits[key] = (state.usage_limits[key] || 0) + 1;
      api.log(state, `${api.pieceById[unit.piece]?.name || id} 减损，为土耳其战线提供 1 RP。`);
  }
return Object.freeze({
    adjustVp,
    advanceFrontMaintenance,
    applyFrontEndTurnEffects,
    beginFrontEndSr,
    beginFrontInvestment,
    beginFrontMaintenance,
    beginFrontMoCommitmentReview,
    chooseFrontInvestment,
    chooseFrontMaintenance,
    clampVp,
    completeSatisfiedFrontMos,
    commitFrontMo,
    declineFrontMo,
    finishFrontEndSr,
    finishFrontInvestment,
    frontEndSrFactions,
    frontMovementLocked,
    frontInvestmentAvailable,
    frontInvestmentCanComplete,
    frontInvestmentPaymentChoices,
    frontInvestmentSpec,
    frontUnitPaymentCandidates,
    frontMaintenanceChoices,
    frontMaintenanceEventChoices,
    frontMaintenanceLossCandidates,
    frontMaintenanceRates,
    frontMaintenanceReductionCandidates,
    frontMoCommitmentCandidates,
    frontMoCommitmentPlan,
    frontMoReservedRp,
    frontMoLossCandidates,
    frontMoObligation,
    frontPaymentIncrement,
    frontVpValue,
    moveFront,
    payFrontWithUnit,
    payTurkishFrontStep,
    takeFrontMoLoss,
    takeFrontMaintenanceLoss,
    turkishFrontStepCandidates,
    unitFrontRpKeys,
  });
}

module.exports = { createFrontSystem };
