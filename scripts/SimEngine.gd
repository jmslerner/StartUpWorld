extends Node

var rng := RandomNumberGenerator.new()

func _ready() -> void:
	rng.seed = 1337

func hire_role(role: String) -> String:
	if not GameState.team.has(role):
		return "Unknown role."
	if not _consume_action():
		return "No action points left this week."
	GameState.team[role] += 1
	if role == "engineer":
		GameState.burn_per_week += 800.0
	elif role == "gtm":
		GameState.burn_per_week += 700.0
	elif role == "hr":
		GameState.burn_per_week += 600.0
	GameState.morale = clamp(GameState.morale + 0.02, 0.0, 1.0)
	return "Hired %s." % role

func fire_target(target: String) -> String:
	if not GameState.team.has(target):
		return "Unknown role."
	if GameState.team[target] <= 0:
		return "No %s to fire." % target
	if not _consume_action():
		return "No action points left this week."
	GameState.team[target] -= 1
	if target == "engineer":
		GameState.burn_per_week -= 800.0
	elif target == "gtm":
		GameState.burn_per_week -= 700.0
	elif target == "hr":
		GameState.burn_per_week -= 600.0
	GameState.morale = clamp(GameState.morale - 0.03, 0.0, 1.0)
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
	GameState.product_progress = clamp(GameState.product_progress + 12.0 + GameState.team["engineer"] * 2.0, 0.0, 100.0)
	GameState.tech_debt = clamp(GameState.tech_debt + 2.5, 0.0, 100.0)
	GameState.churn = clamp(GameState.churn - 0.01, 0.01, 0.2)
	GameState.mrr += 250.0
	return "Shipped feature '%s'." % feature

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
	GameState.users += 25 + GameState.team["gtm"] * 5
	GameState.cac = clamp(GameState.cac + 10.0, 30.0, 200.0)
	return "Launched campaign '%s'." % campaign

func enterprise_outreach() -> String:
	if not _consume_action():
		return "No action points left this week."
	GameState.users += 10
	GameState.mrr += 400.0
	GameState.risk = clamp(GameState.risk + 0.05, 0.0, 1.0)
	return "Enterprise outreach underway."

func pitch_investors() -> String:
	if not _consume_action():
		return "No action points left this week."
	var score := GameState.product_progress + GameState.brand * 40.0 - GameState.risk * 20.0
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

func cut_costs() -> String:
	if not _consume_action():
		return "No action points left this week."
	GameState.burn_per_week *= 0.85
	GameState.morale = clamp(GameState.morale - 0.05, 0.0, 1.0)
	return "Cut costs. Burn reduced."

func end_week() -> String:
	GameState.week += 1
	GameState.action_points = 2
	GameState.cash -= GameState.burn_per_week
	var churned := int(GameState.users * GameState.churn)
	GameState.users = max(0, GameState.users - churned)
	var organic := 5 + int(GameState.brand * 20.0) + rng.randi_range(0, 2)
	GameState.users += organic
	GameState.mrr = GameState.users * (8.0 + GameState.brand * 4.0)
	GameState.tech_debt = clamp(GameState.tech_debt + 0.5, 0.0, 100.0)
	GameState.churn = clamp(GameState.churn + GameState.tech_debt * 0.002 - GameState.product_progress * 0.0005 - GameState.brand * 0.002, 0.01, 0.2)
	GameState.cac = clamp(120.0 - GameState.brand * 40.0 - GameState.team["gtm"] * 5.0 + GameState.risk * 10.0, 30.0, 200.0)
	var arpu := GameState.mrr / max(1, GameState.users)
	GameState.ltv = arpu / max(0.01, GameState.churn)
	return "Week %d complete. Burned $%.0f, users %d, MRR $%.0f." % [GameState.week, GameState.burn_per_week, GameState.users, GameState.mrr]

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
