extends Node

var rng := RandomNumberGenerator.new()
var quote_rng := RandomNumberGenerator.new()

func _ready() -> void:
	rng.seed = 1337
	quote_rng.seed = 424242

func founder_quote() -> String:
	var quotes: Array[String] = [
		"We don't have a roadmap, we have a vibes map.",
		"Revenue is just user growth that went to business school.",
		"If it's not on fire, are you even iterating?",
		"We pivoted so hard we invented a new direction: diagonally up.",
		"Our biggest competitor is gravity — it keeps pulling the burn rate down on us.",
		"We shipped an MVP. It stands for Mostly Vague Promise.",
		"The secret to founder mental health is pretending churn is 'engagement'.",
		"We have unlimited upside and a very limited bank account.",
		"We don't have bugs. We have surprise features with commitment issues.",
		"If you can't measure it, put it in a dashboard anyway.",
		"The product isn't done until the slide deck says it is.",
		"We didn't miss payroll. We launched a compensation delay experiment.",
		"My work-life balance is 70/30: 70% work, 30% anxiety.",
		"Our culture is transparency — you can see the panic in everyone's eyes.",
		"We have strong fundamentals: a weak moat and a powerful belief system.",
		"Shipping fast is easy. Shipping good is a premium tier.",
		"We reduced costs by turning off morale.",
		"The runway is long if you stop looking at it.",
		"I love entrepreneurship: it's like speedrunning personal development.",
		"Our business model is simple: scale first, details later."
	]
	if quotes.is_empty():
		return ""
	var idx := quote_rng.randi_range(0, quotes.size() - 1)
	return "\"%s\" — Anonymous founder" % quotes[idx]

# ---- Upgrade Catalog ----

func _upgrade_catalog() -> Array[Dictionary]:
	return [
		{
			"id": "Nepo Baby Hire",
			"desc": "Your new hire's dad is a VC. +$15K cash, fundraising +10% bonus.",
			"apply": func() -> void:
				GameState.cash += 15000.0
				GameState.upgrade_fundraise_bonus += 10.0,
		},
		{
			"id": "10x Engineer",
			"desc": "Ships at 3x speed. Feature progress +50%, tech debt per feature -30%.",
			"apply": func() -> void:
				GameState.upgrade_feature_progress_mult += 0.5
				GameState.upgrade_feature_debt_mult -= 0.3,
		},
		{
			"id": "Viral Marketer",
			"desc": "500K followers. Campaigns give +100% users.",
			"apply": func() -> void:
				GameState.upgrade_campaign_user_mult += 1.0,
		},
		{
			"id": "Fixer Lawyer",
			"desc": "Legal costs halved. Risk decays 0.02/week passively.",
			"apply": func() -> void:
				GameState.upgrade_legal_cost_mult *= 0.5
				GameState.upgrade_risk_decay += 0.02,
		},
		{
			"id": "Government Contract",
			"desc": "Locked-in $2,000 guaranteed MRR per week, immune to churn.",
			"apply": func() -> void:
				GameState.upgrade_guaranteed_mrr += 2000.0,
		},
		{
			"id": "YC Acceptance",
			"desc": "Brand +0.15, reputation +0.10, one-time $500K cash.",
			"apply": func() -> void:
				GameState.brand = clamp(GameState.brand + 0.15, 0.0, 1.0)
				GameState.reputation = clamp(GameState.reputation + 0.10, 0.0, 1.0)
				GameState.cash += 500000.0,
		},
		{
			"id": "Strategic Partnership",
			"desc": "Enterprise outreach gives 2x MRR. Brand +0.05.",
			"apply": func() -> void:
				GameState.upgrade_enterprise_mrr_mult += 1.0
				GameState.brand = clamp(GameState.brand + 0.05, 0.0, 1.0),
		},
		{
			"id": "Patent Portfolio",
			"desc": "Competitors can't clone your features. 'Competitor launches' event disabled.",
			"apply": func() -> void:
				GameState.upgrade_competitor_immune = true,
		},
		{
			"id": "Second Wind",
			"desc": "+1 action point per week permanently (3 AP instead of 2).",
			"apply": func() -> void:
				GameState.upgrade_extra_ap += 1,
		},
		{
			"id": "Frugal Founder",
			"desc": "All burn reduced by 10% permanently.",
			"apply": func() -> void:
				GameState.upgrade_burn_mult *= 0.9,
		},
		{
			"id": "Network Effect",
			"desc": "Organic user growth +50% every week.",
			"apply": func() -> void:
				GameState.upgrade_organic_mult += 0.5,
		},
		{
			"id": "War Chest",
			"desc": "One-time $25K cash + borrow limit doubled.",
			"apply": func() -> void:
				GameState.cash += 25000.0
				GameState.upgrade_borrow_mult *= 2.0,
		},
	]

func offer_upgrades() -> String:
	var catalog := _upgrade_catalog()
	var available: Array[Dictionary] = []
	for u in catalog:
		if not GameState.active_upgrades.has(u["id"]):
			available.append(u)
	if available.size() < 3:
		return ""
	# Shuffle and pick 3
	var picks: Array[Dictionary] = []
	while picks.size() < 3 and available.size() > 0:
		var idx := rng.randi_range(0, available.size() - 1)
		picks.append(available[idx])
		available.remove_at(idx)
	GameState.pending_upgrade = picks
	var lines: Array[String] = []
	lines.append("")
	lines.append("=== UPGRADE AVAILABLE ===")
	lines.append("Choose a permanent upgrade:")
	lines.append("")
	for i in range(picks.size()):
		lines.append("  %d) %s" % [i + 1, picks[i]["id"]])
		lines.append("     %s" % picks[i]["desc"])
	lines.append("")
	lines.append("Type 1, 2, or 3:")
	return "\n".join(lines)

func apply_upgrade(index: int) -> String:
	if index < 0 or index >= GameState.pending_upgrade.size():
		return "Invalid choice. Type 1, 2, or 3."
	var chosen: Dictionary = GameState.pending_upgrade[index]
	chosen["apply"].call()
	GameState.active_upgrades.append(chosen["id"])
	GameState.pending_upgrade = []
	return "Upgrade acquired: %s\n%s" % [chosen["id"], chosen["desc"]]

# ---- Role Costs ----

func _role_cost(role: String) -> float:
	var base := 0.0
	match role:
		"engineer":
			base = 800.0
		"gtm":
			base = 700.0
		"hr":
			base = 600.0
		"legal":
			base = 900.0
	return base * GameState._reputation_cost_modifier()

# ---- Actions ----

func hire_role(role: String) -> String:
	if not GameState.team.has(role):
		return "Unknown role."
	if not _consume_action():
		return "No action points left this week."
	GameState.team[role] += 1
	var cost := _role_cost(role)
	GameState.burn_per_week += cost
	GameState.morale = clamp(GameState.morale + 0.02, 0.0, 1.0)
	return "Hired %s ($%.0f/week)." % [role, cost]

func fire_target(target: String) -> String:
	if not GameState.team.has(target):
		return "Unknown role."
	if GameState.team[target] <= 0:
		return "No %s to fire." % target
	if not _consume_action():
		return "No action points left this week."
	GameState.team[target] -= 1
	var cost := _role_cost(target)
	GameState.burn_per_week -= cost
	GameState.morale = clamp(GameState.morale - 0.03, 0.0, 1.0)
	GameState.reputation = clamp(GameState.reputation - 0.02, 0.0, 1.0)
	GameState.fired_recently = true
	return "Fired %s." % target

func rent_office(tier: String) -> String:
	var cost := _office_cost(tier)
	if cost < 0.0:
		return "Unknown office tier."
	if not _consume_action():
		return "No action points left this week."
	GameState.burn_per_week += cost - GameState.office_rent
	GameState.office_rent = cost
	GameState.office_tier = tier
	GameState.morale = clamp(GameState.morale + 0.05, 0.0, 1.0)
	return "Moved to %s." % tier

func ship_feature(name: String) -> String:
	var feature := name.strip_edges()
	if feature.is_empty():
		return "Name the feature."
	if not _consume_action():
		return "No action points left this week."
	GameState.features_shipped.append(feature.to_lower())
	var progress: float = (12.0 + GameState.team["engineer"] * 2.0) * GameState.upgrade_feature_progress_mult
	var debt: float = 2.5 * max(0.1, GameState.upgrade_feature_debt_mult)
	GameState.product_progress = clamp(GameState.product_progress + progress, 0.0, 100.0)
	GameState.tech_debt = clamp(GameState.tech_debt + debt, 0.0, 100.0)
	GameState.churn = clamp(GameState.churn - 0.01, 0.01, 0.2)
	GameState.mrr += GameState.feature_mrr_bonus
	GameState.reputation = clamp(GameState.reputation + 0.01, 0.0, 1.0)
	return "Shipped feature '%s'. (+%.1f progress, +%.1f debt)" % [feature, progress, debt]

func refactor() -> String:
	if not _consume_action():
		return "No action points left this week."
	GameState.tech_debt = clamp(GameState.tech_debt - 6.0, 0.0, 100.0)
	GameState.product_progress = clamp(GameState.product_progress + 3.0, 0.0, 100.0)
	GameState.morale = clamp(GameState.morale + 0.03, 0.0, 1.0)
	return "Refactor complete."

func launch_campaign(name: String) -> String:
	var campaign := name.strip_edges()
	if campaign.is_empty():
		return "Name the campaign."
	if not _consume_action():
		return "No action points left this week."
	GameState.campaigns.append(campaign)
	GameState.brand = clamp(GameState.brand + 0.08, 0.0, 1.0)
	var user_gain := int((GameState.campaign_user_bonus + GameState.team["gtm"] * 5) * GameState.upgrade_campaign_user_mult)
	GameState.users += user_gain
	GameState.cac = clamp(GameState.cac + 10.0, 30.0, 200.0)
	return "Launched campaign '%s'. +%d users." % [campaign, user_gain]

func enterprise_outreach() -> String:
	if not _consume_action():
		return "No action points left this week."
	GameState.users += 10
	var mrr_gain := GameState.enterprise_mrr_bonus * GameState.upgrade_enterprise_mrr_mult
	GameState.mrr += mrr_gain
	GameState.risk = clamp(GameState.risk + 0.05, 0.0, 1.0)
	return "Enterprise outreach underway. +$%.0f MRR." % mrr_gain

func pitch_investors() -> String:
	if not _consume_action():
		return "No action points left this week."
	var score := GameState.product_progress + GameState.brand * 40.0 - GameState.risk * 20.0 + GameState.upgrade_fundraise_bonus
	var roll := rng.randi_range(0, 100)
	if roll < int(score):
		GameState.cash += 10000.0
		GameState.morale = clamp(GameState.morale + 0.05, 0.0, 1.0)
		return "Pitch went well. Investors are interested."
	return "Pitch fizzled. Come back with more traction."

func raise_round(round_name: String, amount: float) -> String:
	if amount <= 0.0:
		return "Raise amount must be positive."
	if not _consume_action():
		return "No action points left this week."
	GameState.cash += amount
	GameState.risk = clamp(GameState.risk - 0.05, 0.0, 1.0)
	GameState.morale = clamp(GameState.morale + 0.04, 0.0, 1.0)
	return "Raised %s $%.0f." % [round_name, amount]

func borrow(amount: float) -> String:
	if amount <= 0.0:
		return "Borrow amount must be positive."
	if not _consume_action():
		return "No action points left this week."
	var max_borrow := GameState.valuation * 0.2 * GameState.upgrade_borrow_mult
	if max_borrow < 5000.0:
		max_borrow = 5000.0
	if amount > max_borrow:
		return "Lenders won't lend more than $%.0f based on your valuation." % max_borrow
	GameState.cash += amount
	GameState.debt += amount
	var warning := ""
	if GameState.debt > GameState.cash * 0.5:
		warning = " Warning: debt is over 50%% of cash."
	return "Borrowed $%.0f. Total debt: $%.0f at %.0f%% weekly interest.%s" % [amount, GameState.debt, GameState.debt_interest_rate * 100, warning]

func raise_safe(amount: float) -> String:
	if amount <= 0.0:
		return "Amount must be positive."
	if GameState.valuation <= 0.0:
		return "Company has no valuation yet. End a week first."
	if not _consume_action():
		return "No action points left this week."
	GameState.cash += amount
	var new_dilution := (amount / GameState.valuation) * 100.0
	GameState.dilution += new_dilution
	GameState.risk = clamp(GameState.risk - 0.03, 0.0, 1.0)
	return "SAFE note: received $%.0f. Dilution increased by %.1f%% (total: %.1f%%)." % [amount, new_dilution, GameState.dilution]

func mortgage_house() -> String:
	if GameState.house_mortgaged:
		return "You already mortgaged your house."
	if not _consume_action():
		return "No action points left this week."
	GameState.house_mortgaged = true
	GameState.cash += 50000.0
	GameState.reputation = clamp(GameState.reputation - 0.05, 0.0, 1.0)
	GameState.risk = clamp(GameState.risk + 0.08, 0.0, 1.0)
	GameState.morale = clamp(GameState.morale + 0.03, 0.0, 1.0)
	return "You mortgaged your house for $50,000. The team sees your commitment, but the stakes just got personal."

func borrow_friends(amount: float) -> String:
	if GameState.friends_borrowed:
		return "You already borrowed from friends and family."
	if amount <= 0.0:
		return "Amount must be positive."
	if amount > 15000.0:
		return "Your friends and family can only lend up to $15,000."
	if not _consume_action():
		return "No action points left this week."
	GameState.friends_borrowed = true
	GameState.cash += amount
	GameState.reputation = clamp(GameState.reputation - 0.03, 0.0, 1.0)
	GameState.morale = clamp(GameState.morale + 0.02, 0.0, 1.0)
	return "Borrowed $%.0f from friends and family. No pressure, right?" % amount

func sell_company() -> String:
	if GameState.active_offer.is_empty():
		return "No active acquisition offer. Wait for one."
	var buyer: String = GameState.active_offer["buyer"]
	var amount: float = GameState.active_offer["amount"]
	GameState.game_over = true
	return "SOLD! %s acquires your company for %s.\nYou ring the bell, cash the check, and start thinking about your next venture.\nThanks for playing StartUpWorld." % [buyer, GameState._format_money(amount)]

func ipo() -> String:
	if GameState.valuation < 1_000_000_000.0:
		return "Valuation must be $1B+ to IPO. Current: %s." % GameState._format_money(GameState.valuation)
	if GameState.product_progress < 80.0:
		return "Product progress must be 80%+ to IPO. Current: %.1f%%." % GameState.product_progress
	if GameState.churn > 0.05:
		return "Churn must be 5%% or less to IPO. Current: %.2f." % GameState.churn
	if not _consume_action():
		return "No action points left this week."
	GameState.game_over = true
	return "IPO! You ring the opening bell at NYSE.\nYour company goes public at a %s valuation.\nInvestors are paid back. You made it.\nThanks for playing StartUpWorld." % GameState._format_money(GameState.valuation)

func cut_costs() -> String:
	if not _consume_action():
		return "No action points left this week."
	GameState.burn_per_week *= 0.85
	GameState.morale = clamp(GameState.morale - 0.05, 0.0, 1.0)
	return "Cut costs. Burn reduced."

# ---- End Week ----

func end_week() -> String:
	GameState.week += 1
	GameState.action_points = 2 + GameState.upgrade_extra_ap
	# Debt interest
	if GameState.debt > 0.0:
		var interest := GameState.debt * GameState.debt_interest_rate
		GameState.cash -= interest
		GameState.debt += interest
	# Weekly burn (with frugal founder upgrade)
	var effective_burn := GameState.burn_per_week * GameState.upgrade_burn_mult
	GameState.cash -= effective_burn
	# User churn and growth
	var churned := int(GameState.users * GameState.churn)
	GameState.users = max(0, GameState.users - churned)
	var organic := GameState.organic_growth_base + int(GameState.brand * GameState.organic_brand_mult) + rng.randi_range(0, 2)
	organic = int(organic * GameState.upgrade_organic_mult)
	GameState.users += organic
	# Recalculate financials
	GameState.mrr = GameState.users * (GameState.arpu_base + GameState.brand * GameState.arpu_brand_bonus) + GameState.upgrade_guaranteed_mrr
	GameState.tech_debt = clamp(GameState.tech_debt + 0.5, 0.0, 100.0)
	GameState.churn = clamp(GameState.churn + GameState.tech_debt * 0.002 - GameState.product_progress * 0.0005 - GameState.brand * 0.002, 0.01, 0.2)
	GameState.cac = clamp(GameState.cac_base - GameState.brand * 40.0 - GameState.team["gtm"] * 5.0 + GameState.risk * 10.0, 30.0, 200.0)
	var arpu: float = GameState.mrr / max(1, GameState.users)
	GameState.ltv = arpu / max(0.01, GameState.churn)
	# Passive risk decay from upgrades
	if GameState.upgrade_risk_decay > 0.0:
		GameState.risk = clamp(GameState.risk - GameState.upgrade_risk_decay, 0.0, 1.0)
	# Reputation drift toward 0.5
	var rep_drift := (0.5 - GameState.reputation) * 0.02
	GameState.reputation = clamp(GameState.reputation + rep_drift + GameState.morale * 0.005 + GameState.brand * 0.003, 0.0, 1.0)
	# Valuation calculation
	var multiple := 8.0 + GameState.brand * 25.0 + GameState.product_progress * 0.3 + GameState.reputation * 10.0 - GameState.risk * 15.0 - GameState.tech_debt * 0.1
	multiple = clamp(multiple, 2.0, 50.0)
	GameState.valuation = GameState.mrr * 12.0 * multiple * (1.0 - GameState.dilution / 100.0)
	# Clear expired offer
	GameState.active_offer = {}
	# Reset fired flag
	GameState.fired_recently = false
	# Build summary
	var summary := "Week %d complete. Burned $%.0f, users %d, MRR $%.0f, valuation %s." % [GameState.week, effective_burn, GameState.users, GameState.mrr, GameState._format_money(GameState.valuation)]
	if GameState.debt > 0.0:
		summary += "\nDebt interest: $%.0f. Total debt: $%.0f." % [GameState.debt * GameState.debt_interest_rate / (1.0 + GameState.debt_interest_rate), GameState.debt]
	# Milestone checks
	summary += _check_milestones()
	# Random event
	var event_text := EventSystem.roll_event()
	if not event_text.is_empty():
		summary += event_text
	# Upgrade offer every 5 weeks
	if GameState.week % 5 == 0:
		var upgrade_text := offer_upgrades()
		if not upgrade_text.is_empty():
			summary += upgrade_text
	return summary

func _check_milestones() -> String:
	var text := ""
	var ratio := 0.0
	if GameState.cac > 0.0:
		ratio = GameState.ltv / GameState.cac
	if not GameState.milestones.has("pmf") and GameState.product_progress >= 80.0 and ratio >= 3.0 and GameState.churn <= 0.05:
		GameState.milestones.append("pmf")
		text += "\n*** MILESTONE: Product-Market Fit achieved! ***"
	if not GameState.milestones.has("unicorn") and GameState.valuation >= 1_000_000_000.0:
		GameState.milestones.append("unicorn")
		text += "\n*** MILESTONE: UNICORN STATUS! Valuation hit $1B! ***"
		text += "\nYou can now IPO with 'ipo' command."
	if not GameState.milestones.has("mega") and GameState.valuation >= 5_000_000_000.0:
		GameState.milestones.append("mega")
		text += "\n*** MILESTONE: $5B VALUATION! Big tech is watching. ***"
		text += "\nExpect acquisition offers from Google, Meta, or Oracle."
	return text

func _consume_action(cost: int = 1) -> bool:
	if GameState.action_points < cost:
		return false
	GameState.action_points -= cost
	return true

func _office_cost(tier: String) -> float:
	match tier:
		"garage":
			return 300.0
		"coworking":
			return 1200.0
		"office":
			return 3500.0
		_:
			return -1.0
