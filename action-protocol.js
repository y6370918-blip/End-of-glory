"use strict"

;(function (root, factory) {
	const protocol = factory()
	if (typeof module === "object" && module.exports) module.exports = protocol
	else root.EogActionProtocol = protocol
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	const VERSION = 1
	const primitive = (value) => typeof value === "string" || typeof value === "number"

	const catalog = Object.freeze({
		done: { label: "确认" },
		one_op: { label: "使用 1 OP" },
		stop: { label: "结束移动" },
		proceed_retreat: { label: "撤退" },
		decline_optional_retreat: { label: "不撤退" },
		reinforcement_to_reserve: { label: "放入预备区" },
		cancel: { label: "取消" },
		regular_attack: { label: "普通进攻" },
		flank_attack: { label: "侧翼进攻" },
		choose_all_out_attack: { target: "option", label: "本次忽略战壕" },
		skip_all_out_attack: { label: "保留额度" },
		confirm_mo: { label: "确认" },
		commit_front_mo: { target: "option", surface: "target", label: "承诺完成战线MO" },
		decline_front_mo: { label: "不承诺" },
		reset_defense_mo: { label: "重新选择防御MO" },
		confirm_mo_penalty_loss: { label: "确认非致命减员" },
		confirm_losses: { label: "确认损失" },
		retain_combat_card: { target: "card", surface: "top", label: "保留战斗牌" },
		discard_combat_card_for_draw: { target: "card", surface: "top", label: "弃置并抽一张牌" },
		event_units_confirm: { label: "确认所选单位" },
		event_confirm: { label: "确认事件" },
		event_cancel: { label: "取消事件" },
		cancel_sr_unit: { label: "取消战略转移单位" },
		pass: { label: "不使用战斗牌" },
		finish: { label: "结束" },
		end_advance: { label: "结束挺进" },
		confirm_discard_replacement_rp: { label: "放弃剩余补员点" },
		undo: { label: "撤销" },
		propose_rollback: { target: "option", surface: "toolbar", label: "提议回滚" },
		accept_rollback: { label: "接受回滚" },
		reject_rollback: { label: "拒绝回滚" },
		confirm_rollback: { label: "确认回滚结果" },
		flag_supply_warnings: { surface: "toolbar", label: "标记补给警告" },
		finish_supply_warnings: { label: "完成补给警告" },
		acknowledge_supply_warnings: { label: "确认收到补给警告" },
		finish_august_reposition: { label: "完成八月炮火重部署" },

		activate_move: { target: "space", label: "激活移动" },
		activate_attack: { target: "space", label: "激活进攻" },
		activate_construct: { target: "space", label: "修筑/组合" },
		select_activation_unit: { target: "piece", label: "选择激活单位" },
		deselect_activation_unit: { target: "piece", label: "取消选择单位" },
		activation_confirm: { label: "确认" },
		activation_cancel: { label: "取消" },
		resolve_stack: { target: "space", label: "结算堆叠" },
		move: { target: "space", label: "移动" },
		entrench: { target: "space", label: "掘壕" },
		event_space: { target: "space", label: "选择地区" },
		declare_attack: { target: "space", label: "进攻" },
		sr_destination: { target: "space", label: "战略转移" },
		retreat_destination: { target: "space", label: "撤退" },
		advance_destination: { target: "space", label: "挺进" },
		voluntary_remove_fortification: { target: "space", label: "移除防御工事" },
		voluntary_reduce_trench: { target: "space", label: "降低战壕" },
		select_supply_warning: { target: "space", label: "标记补给警告" },
		deselect_supply_warning: { target: "space", label: "取消补给警告" },

		select_move_unit: { target: "piece", label: "选择移动单位" },
		deselect_move_unit: { target: "piece", label: "取消移动单位" },
		drop_move_unit: { target: "piece", label: "将该单位留在此地" },
		select_attacker: { target: "piece", label: "选择进攻单位" },
		deselect_attacker: { target: "piece", label: "取消进攻单位" },
		select_sr_unit: { target: "piece", label: "选择战略转移单位" },
		return_schlieffen_unit: { target: "piece", label: "送回预备区" },
		select_retreat_unit: { target: "piece", label: "选择撤退单位" },
		select_retreat_one: { target: "piece", label: "撤退 1 格" },
		select_retreat_two: { target: "piece", label: "撤退 2 格" },
		deselect_retreat_unit: { target: "piece", label: "取消撤退单位" },
		select_advance_unit: { target: "piece", label: "选择挺进单位" },
		select_august_unit: { target: "piece", label: "选择八月炮火重部署单位" },
		deselect_august_unit: { target: "piece", label: "取消八月炮火重部署单位" },
		select_event_unit: { target: "piece", label: "选择单位" },
		deselect_event_unit: { target: "piece", label: "取消选择单位" },
		select_mo_penalty_unit: { target: "piece", label: "选择MO处罚单位" },
		deselect_mo_penalty_unit: { target: "piece", label: "取消MO处罚单位" },
		take_loss: { target: "piece", label: "承受损失" },
		eliminate: { target: "piece", label: "消灭" },
		cancel_retreat: { target: "piece", label: "取消撤退" },
		retreat_loss: { target: "piece", label: "承受撤退损失" },
		mo_front_loss: { target: "piece", label: "战线损失" },
		front_unit_payment: { target: "piece", label: "减损单位" },
		front_maintenance_loss: { target: "piece", label: "战线维持损耗" },
		voluntary_destroy_unit: { target: "piece", label: "自愿摧毁" },
		spend_flip: { target: "piece", label: "修复单位" },
		spend_upgrade: { target: "piece", label: "升级单位" },
		spend_rebuild: { target: "piece", label: "重建单位" },
		select_combine_lcu: { target: "piece", label: "选择组合LCU" },
		select_combine_scu: { target: "piece", label: "选择组合SCU" },
		replacement_to_reserve: { label: "放入预备区" },
		replacement_to_eliminated: { surface: "target", label: "留在消灭区" },
		event_front_step: { target: "piece", label: "减损单位" },

		card_ops: { target: "card", label: "行动点" },
		card_sr: { target: "card", label: "战略转移" },
		card_rp: { target: "card", label: "补员" },
		card_event: { target: "card", label: "事件" },
		naval_event: { target: "card", label: "事件" },
		naval_fleet: { target: "card", label: "舰队" },
		naval_empty_fleet: { label: "无牌舰队" },
		select_opening_card: { target: "card", label: "选择开局卡牌" },
		skip_august_guns: { label: "不保证八月炮火" },
		naval_discard: { label: "弃置" },
		naval_shuffle: { label: "洗回牌库" },
		combat_card: { target: "card", label: "战斗牌" },
		discard_combat_card: { target: "card", label: "弃置战斗牌" },

		event_choose: { target: "option", label: "事件选择" },
		event_exchange: { target: "option", label: "交换补员" },
		spend_option: { target: "piece", label: "支付" },
		spend_front: { target: "option", label: "推进战线" },
		convert_east_rp: { target: "option", label: "转换 EAST RP" },
		choose_replacement: { target: "piece", label: "选择替代单位" },
		choose_flank_final: { target: "option", label: "侧翼分配" },
		select_attack_mo: { target: "option", surface: "target", label: "选择本次进攻MO" },
		select_defense_mo: { target: "option", surface: "target", label: "选择本次防御MO" }
	})

	function surfaceFor(action) {
		const entry = catalog[action]
		if (entry?.surface) return entry.surface
		if (["space", "piece", "card"].includes(entry?.target)) return "target"
		return "top"
	}

	function assertPrimitive(value, action) {
		if (!primitive(value) || (typeof value === "number" && !Number.isFinite(value)))
			throw new TypeError(`Action ${action} contains a non-primitive argument`)
	}

	function validate(actions) {
		if (!actions || typeof actions !== "object" || Array.isArray(actions))
			throw new TypeError("Actions must be an object")
		for (const [action, value] of Object.entries(actions)) {
			if (value === 0 || value === 1) continue
			if (!Array.isArray(value)) throw new TypeError(`Action ${action} must be 0, 1, or an array`)
			if (!value.length) throw new TypeError(`Action ${action} must not be an empty array`)
			const seen = new Set()
			for (const arg of value) {
				assertPrimitive(arg, action)
				const key = `${typeof arg}:${arg}`
				if (seen.has(key)) throw new TypeError(`Action ${action} contains duplicate argument ${arg}`)
				seen.add(key)
			}
		}
		return actions
	}

	class ActionBuilder {
		constructor() {
			this.actions = {}
			this.labels = {}
		}
		enable(action, enabled = true) {
			this.actions[action] = enabled ? 1 : 0
			return this
		}
		add(action, arg, label) {
			assertPrimitive(arg, action)
			if (!Array.isArray(this.actions[action])) this.actions[action] = []
			if (!this.actions[action].includes(arg)) this.actions[action].push(arg)
			if (label !== undefined) {
				if (!this.labels[action]) this.labels[action] = {}
				this.labels[action][String(arg)] = String(label)
			}
			return this
		}
		addAll(action, args) {
			for (const arg of args || []) this.add(action, arg)
			return this
		}
		finish() {
			validate(this.actions)
			return { actions: this.actions, labels: this.labels }
		}
	}

	function allows(actions, action, arg) {
		if (!actions || !(action in actions)) return false
		const legal = actions[action]
		if (arg === undefined || arg === null) return legal === 1
		return Array.isArray(legal) && primitive(arg) && legal.includes(arg)
	}

	function entriesFor(actions, target) {
		const result = new Map()
		for (const [action, args] of Object.entries(actions || {})) {
			if (catalog[action]?.client === false || catalog[action]?.target !== target || !Array.isArray(args)) continue
			for (const arg of args) {
				const key = action === "spend_option"
					? String(arg).split(":")[1]
					: action === "front_maintenance_loss"
						? String(arg).split(":")[0]
						: arg
				if (!result.has(key)) result.set(key, [])
				result.get(key).push({ action, arg })
			}
		}
		return result
	}

	function indexTargets(actions) {
		validate(actions || {})
		return {
			spaces: entriesFor(actions, "space"),
			pieces: entriesFor(actions, "piece"),
			cards: entriesFor(actions, "card"),
			options: entriesFor(actions, "option")
		}
	}

	function labelFor(action, arg, labels) {
		return labels?.[action]?.[String(arg)] || catalog[action]?.label || action
	}

	return Object.freeze({ VERSION, catalog, ActionBuilder, validate, allows, indexTargets, labelFor, surfaceFor })
})
