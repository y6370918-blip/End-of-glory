"use strict";

function replacementSpend(state, api) {
  const obligation = api.frontMoObligation(state, state.active);
  if (obligation)
    return {
      flip: [],
      upgrade: [],
      rebuild: [],
      options: [],
      fronts: [obligation.front].filter((track) =>
        api.replacementOption(state, { kind: "front", track }),
      ),
    };
  const units = state.units.concat(state.eliminated[state.active] || []);
  const options = units.flatMap((unit) =>
    ["flip", "upgrade", "rebuild"].flatMap((kind) =>
      api
        .replacementKeys(unit)
        .map((key) => ({ kind, unit: unit.id, key }))
        .filter((arg) => api.replacementOption(state, arg)),
    ),
  );
  const optionCount = (kind, unit) =>
    options.filter((option) => option.kind === kind && option.unit === unit).length;
  return {
    flip: state.units
      .filter((unit) => api.replacementOption(state, { kind: "flip", unit: unit.id }))
      .filter((unit) => optionCount("flip", unit.id) === 1)
      .map((unit) => unit.id),
    upgrade: units
      .filter((unit) => api.replacementOption(state, { kind: "upgrade", unit: unit.id }))
      .filter((unit) => optionCount("upgrade", unit.id) === 1)
      .map((unit) => unit.id),
    rebuild: (state.eliminated?.[state.active] || [])
      .filter((unit) => api.replacementOption(state, { kind: "rebuild", unit: unit.id }))
      .filter((unit) => optionCount("rebuild", unit.id) === 1)
      .map((unit) => unit.id),
    options: options.filter((option) => optionCount(option.kind, option.unit) > 1),
    fronts: ["russian", "turkish"].filter((track) =>
      api.replacementOption(state, { kind: "front", track }),
    ),
  };
}

function createTurnStates(api) {
  return {
    opening_ap_card: {
      message: "选择一张4 OP动员牌。",
      prompt(state, builder) {
        builder.addAll("select_opening_card", api.openingCardCandidates(state));
      },
      select_opening_card: api.selectOpeningCard,
    },

    opening_cp_august_guns: {
      message: "选择是否保证获得八月炮火。",
      prompt(state, builder) {
        builder.addAll("select_opening_card", api.openingCardCandidates(state));
        builder.enable("skip_august_guns");
      },
      select_opening_card: api.selectOpeningCard,
      skip_august_guns: api.skipAugustGuns,
    },

    mo_review: {
      message: "确认MO。",
      prompt(_state, builder) {
        builder.enable("confirm_mo");
      },
      confirm_mo(state) {
        api.confirmMoReview(state, state.active);
      },
    },

    front_mo_commit: {
      message: "选择是否承诺完成战线MO。",
      prompt(state, builder) {
        builder.addAll("commit_front_mo", api.frontMoCommitmentCandidates(state, state.active));
        builder.enable("decline_front_mo");
      },
      commit_front_mo(state, id) {
        api.clearUndo(state);
        api.commitFrontMo(state, id);
      },
      decline_front_mo(state) {
        api.clearUndo(state);
        api.declineFrontMo(state);
      },
    },

    naval_choice: {
      message: "选择海军牌。",
      prompt(state, builder) {
        const hand = state.hands[state.active];
        if (hand.length) builder.addAll("naval_fleet", hand);
        else builder.enable("naval_empty_fleet");
        for (const id of hand.filter((cardId) =>
          api.navalEventLegal(state, api.cardById[cardId], api.eventLegal),
        )) {
          const cost = api.entryGapVpCost(state, api.cardById[id]);
          builder.add("naval_event", id, cost ? `事件（+${cost} VP）` : "事件");
        }
      },
      naval_event(state, card) {
        api.clearUndo(state);
        api.navalChoice(state, { kind: "event", card });
      },
      naval_fleet(state, card) {
        api.clearUndo(state);
        api.navalChoice(state, { kind: "fleet", card });
      },
      naval_empty_fleet(state) {
        api.clearUndo(state);
        api.navalChoice(state, { kind: "fleet", card: null });
      },
    },

    naval_disposition: {
      message: "处理舰队牌。",
      prompt(_state, builder) {
        builder.enable("naval_discard");
        builder.enable("naval_shuffle");
      },
      naval_discard(state) {
        api.navalDisposition(state, "discard");
      },
      naval_shuffle(state) {
        api.navalDisposition(state, "shuffle");
      },
    },

    replacement: {
      message: "补员。",
      prompt(state, builder) {
        const spend = replacementSpend(state, api);
        builder.addAll("spend_flip", spend.flip);
        builder.addAll("spend_upgrade", spend.upgrade);
        builder.addAll("spend_rebuild", spend.rebuild);
        builder.addAll("spend_front", spend.fronts);
        builder.addAll("convert_east_rp", api.eastRpConversionOptions(state));
        for (const option of spend.options)
          builder.add(
            "spend_option",
            `${option.kind}:${option.unit}:${option.key}`,
            `使用 ${option.key.toUpperCase()}:RP`,
          );
        if (state.active === api.AP && state.events[api.cardById[600].event]) {
          const remaining = 2 - (state.usage_limits[`war_aid:${state.turn}`] || 0);
          const routes = [
            ["br_to_fr", "br"],
            ["fr_to_br", "fr"],
            ["us_to_fr", "us"],
            ["fr_to_us", "fr"],
          ];
          for (const [id, source] of routes) {
            if (id.includes("us") && !state.events.entry_us) continue;
            const maximum = Math.min(remaining, state.rp.ap[source] || 0);
            for (let amount = 1; amount <= maximum; amount += 1)
              builder.add("event_exchange", `${id}:${amount}`);
          }
        }
        builder.addAll("event_front_step", api.turkishFrontStepCandidates(state));
        const frontLosses = api.frontMoLossCandidates(state);
        builder.addAll("mo_front_loss", frontLosses);
        const obligation = api.frontMoObligation(state, state.active);
        const spec = obligation
          ? api.frontInvestmentSpec(state, obligation.front, state.active)
          : null;
        const impossible =
          obligation &&
          (!spec || api.frontInvestmentAvailable(state, spec) < spec.cost - 1e-9) &&
          frontLosses.length === 0;
        if (!obligation || impossible) builder.enable("finish");
      },
      spend_flip(state, unit) {
        api.snapshot(state, "补员");
        api.spendReplacement(state, { kind: "flip", unit });
      },
      spend_upgrade(state, unit) {
        api.spendReplacement(state, { kind: "upgrade", unit });
      },
      spend_rebuild(state, unit) {
        api.spendReplacement(state, { kind: "rebuild", unit });
      },
      spend_front(state, track) {
        api.snapshot(state, "补员");
        api.spendReplacement(state, { kind: "front", track });
      },
      spend_option(state, token) {
        const [kind, unit, key] = String(token).split(":");
        if (!["upgrade", "rebuild"].includes(kind)) api.snapshot(state, "补员");
        api.spendReplacement(state, { kind, unit, key });
      },
      mo_front_loss(state, id) {
        api.snapshot(state, "战线 MO 减损");
        api.takeFrontMoLoss(state, id);
      },
      event_front_step(state, id) {
        api.snapshot(state, "Churchill front payment");
        api.payTurkishFrontStep(state, id);
      },
      event_exchange(state, token) {
        const [id, amount] = String(token).split(":");
        api.exchangeWarAid(state, { id, amount: Number(amount) });
      },
      convert_east_rp(state, target) {
        api.snapshot(state, "转换 EAST RP");
        api.convertEastRp(state, target);
      },
      finish(state) {
        const spend = replacementSpend(state, api);
        const usable = spend.flip.length || spend.upgrade.length ||
          spend.rebuild.length || spend.options.length || spend.fronts.length;
        if (!usable) {
          api.finishReplacement(state);
          return;
        }
        state.state = "replacement_discard_confirm";
        state.phase = "放弃剩余补员点";
      },
    },

    replacement_discard_confirm: {
      message: "放弃剩余补员点？",
      prompt(_state, builder) {
        builder.enable("confirm_discard_replacement_rp");
        builder.enable("cancel");
      },
      confirm_discard_replacement_rp: api.finishReplacement,
      cancel(state) {
        state.state = "replacement";
        state.phase = "补员/升级";
      },
    },

    draw_discard: {
      message: "弃置战斗牌。",
      prompt(state, builder) {
        builder.addAll(
          "discard_combat_card",
          state.hands[state.active].filter((id) => api.cardById[id]?.combat_card),
        );
        builder.enable("done");
      },
      discard_combat_card(state, rawId) {
        const id = Number(rawId);
        const index = state.hands[state.active].indexOf(id);
        if (index < 0 || !api.cardById[id]?.combat_card)
          throw new Error("Only a combat card in hand may be discarded");
        api.snapshot(state, "抽牌前弃置战斗牌");
        state.hands[state.active].splice(index, 1);
        state.discard[state.active].push(id);
        api.log(state, `${api.factionRole(state.active)} 在抽牌前弃置一张战斗牌。`);
      },
      done: api.finishDrawDiscard,
    },

    voluntary_cleanup: {
      message: "自愿清理。",
      prompt(state, builder) {
        const options = api.voluntaryCleanupOptions(state, state.active);
        builder.addAll("voluntary_destroy_unit", options.units);
        builder.addAll("voluntary_remove_fortification", options.fortifications);
        builder.addAll("voluntary_reduce_trench", options.trenches);
        builder.enable("done");
      },
      voluntary_destroy_unit(state, id) {
        if (!api.voluntaryCleanupOptions(state, state.active).units.includes(id))
          throw new Error("Unit is not eligible for voluntary fort attrition");
        api.snapshot(state, "自愿摧毁要塞单位");
        api.eliminateUnit(state, id, "自愿摧毁");
        api.updateSupply(state);
      },
      voluntary_remove_fortification(state, space) {
        if (!api.voluntaryCleanupOptions(state, state.active).fortifications.includes(space))
          throw new Error("Fortification is not eligible for voluntary removal");
        api.snapshot(state, "自愿移除防御工事");
        delete state.fortifications[space];
      },
      voluntary_reduce_trench(state, space) {
        if (!api.voluntaryCleanupOptions(state, state.active).trenches.includes(space))
          throw new Error("Trench is not eligible for voluntary reduction");
        api.snapshot(state, "自愿降级战壕");
        state.trenches[space] -= 1;
        if (state.trenches[space] <= 0) delete state.trenches[space];
      },
      done: api.finishVoluntaryCleanup,
    },

    game_over: {
      message: (state) => state.victory,
      prompt() {},
    },
  };
}

module.exports = { createTurnStates };
