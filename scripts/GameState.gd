extends Node

# Onboarding
var founder_name: String = ""
var company_name: String = ""
var archetype: String = ""  # "b2b" or "b2c"
var cofounder: String = ""  # "technical" or "operator"
var setup_complete: bool = false
var game_over: bool = false
var paused: bool = false

# Core state
var week: int = 1
var action_points: int = 2
var cash: float = 20000.0
var burn_per_week: float = 2500.0
var users: int = 50
var mrr: float = 500.0
var cac: float = 120.0
var ltv: float = 600.0
var churn: float = 0.08
var product_progress: float = 5.0
var tech_debt: float = 0.0
var morale: float = 0.6
var brand: float = 0.2
var risk: float = 0.2
var reputation: float = 0.5
var valuation: float = 0.0
var debt: float = 0.0
var debt_interest_rate: float = 0.05
var dilution: float = 0.0
var house_mortgaged: bool = false
var friends_borrowed: bool = false
var active_offer: Dictionary = {}
var milestones: Array[String] = []
var fired_recently: bool = false
var game_won: bool = false

# Fundraising state
var investor_interest_weeks: int = 0
var investor_interest_strength: float = 0.0

var team := {
	"engineer": 0,
	"gtm": 0,
	"hr": 0,
	"legal": 0
}
var office_tier: String = "garage"
var office_rent: float = 300.0
var features_shipped: Array[String] = []
var campaigns: Array[String] = []

func reset() -> void:
	# Onboarding
	founder_name = ""
	company_name = ""
	archetype = ""
	cofounder = ""
	setup_complete = false
	game_over = false
	game_won = false
	paused = false

	# Core state
	week = 1
	action_points = 2
	cash = 20000.0
	burn_per_week = 2500.0
	users = 50
	mrr = 500.0
	cac = 120.0
	ltv = 600.0
	churn = 0.08
	product_progress = 5.0
	tech_debt = 0.0
	morale = 0.6
	brand = 0.2
	risk = 0.2
	reputation = 0.5
	valuation = 0.0
	debt = 0.0
	debt_interest_rate = 0.05
	dilution = 0.0
	house_mortgaged = false
	friends_borrowed = false
	active_offer = {}
	milestones.clear()
	fired_recently = false
	investor_interest_weeks = 0
	investor_interest_strength = 0.0
	team["engineer"] = 0
	team["gtm"] = 0
	team["hr"] = 0
	team["legal"] = 0
	office_tier = "garage"
	office_rent = 300.0
	features_shipped.clear()
	campaigns.clear()

	# Archetype defaults
	arpu_base = 8.0
	arpu_brand_bonus = 4.0
	organic_growth_base = 5
	organic_brand_mult = 20.0
	campaign_user_bonus = 25
	enterprise_mrr_bonus = 400.0
	feature_mrr_bonus = 250.0
	cac_base = 120.0

	# Upgrades / modifiers
	pending_upgrade = []
	active_upgrades.clear()
	upgrade_fundraise_bonus = 0.0
	upgrade_feature_progress_mult = 1.0
	upgrade_feature_debt_mult = 1.0
	upgrade_campaign_user_mult = 1.0
	upgrade_legal_cost_mult = 1.0
	upgrade_risk_decay = 0.0
	upgrade_guaranteed_mrr = 0.0
	upgrade_enterprise_mrr_mult = 1.0
	upgrade_competitor_immune = false
	upgrade_extra_ap = 0
	upgrade_burn_mult = 1.0
	upgrade_organic_mult = 1.0
	upgrade_borrow_mult = 1.0

# Archetype modifiers (set during setup)
var arpu_base: float = 8.0
var arpu_brand_bonus: float = 4.0
var organic_growth_base: int = 5
var organic_brand_mult: float = 20.0
var campaign_user_bonus: int = 25
var enterprise_mrr_bonus: float = 400.0
var feature_mrr_bonus: float = 250.0
var cac_base: float = 120.0

# Roguelike upgrades
var pending_upgrade: Array = []
var active_upgrades: Array[String] = []
var upgrade_fundraise_bonus: float = 0.0
var upgrade_feature_progress_mult: float = 1.0
var upgrade_feature_debt_mult: float = 1.0
var upgrade_campaign_user_mult: float = 1.0
var upgrade_legal_cost_mult: float = 1.0
var upgrade_risk_decay: float = 0.0
var upgrade_guaranteed_mrr: float = 0.0
var upgrade_enterprise_mrr_mult: float = 1.0
var upgrade_competitor_immune: bool = false
var upgrade_extra_ap: int = 0
var upgrade_burn_mult: float = 1.0
var upgrade_organic_mult: float = 1.0
var upgrade_borrow_mult: float = 1.0

func apply_setup() -> String:
	# Archetype effects
	if archetype == "b2b":
		users = 20
		mrr = 500.0
		churn = 0.06
		arpu_base = 25.0
		arpu_brand_bonus = 8.0
		organic_growth_base = 2
		organic_brand_mult = 8.0
		campaign_user_bonus = 10
		enterprise_mrr_bonus = 800.0
		feature_mrr_bonus = 500.0
		cac = 150.0
		cac_base = 150.0
	else:  # b2c
		users = 100
		mrr = 400.0
		churn = 0.10
		arpu_base = 4.0
		arpu_brand_bonus = 2.0
		organic_growth_base = 12
		organic_brand_mult = 35.0
		campaign_user_bonus = 50
		enterprise_mrr_bonus = 200.0
		feature_mrr_bonus = 150.0
		cac = 80.0
		cac_base = 80.0

	# Cofounder effects
	if cofounder == "technical":
		team["engineer"] = 1
		burn_per_week += 800.0
		reputation = 0.55
		product_progress = 10.0
	else:  # operator
		team["gtm"] = 1
		burn_per_week += 700.0
		brand = 0.3
		users += 20

	setup_complete = true

	var lines: Array[String] = []
	lines.append("=" .repeat(50))
	lines.append("%s launches %s!" % [founder_name, company_name])
	lines.append("")
	if archetype == "b2b":
		lines.append("B2B AI SaaS — fewer customers, bigger contracts.")
		lines.append("Starting: %d users, $%.0f MRR, lower churn." % [users, mrr])
	else:
		lines.append("B2C AI — growth is everything, margins come later.")
		lines.append("Starting: %d users, $%.0f MRR, fast organic growth." % [users, mrr])
	lines.append("")
	if cofounder == "technical":
		lines.append("Your technical cofounder joins as your first engineer.")
		lines.append("Bonus: +1 engineer, higher starting product progress, better reputation.")
	else:
		lines.append("Your operator cofounder hits the ground running on sales.")
		lines.append("Bonus: +1 GTM, higher starting brand, +20 users on day one.")
	lines.append("")
	lines.append("Cash: $%.0f | Burn: $%.0f/week | Runway: %d weeks" % [cash, burn_per_week, runway_weeks()])
	lines.append("=" .repeat(50))
	lines.append("")
	lines.append("Type 'help' to see commands. Type 'end' to advance a week.")
	return "\n".join(lines)

func headcount() -> int:
	return team["engineer"] + team["gtm"] + team["hr"] + team["legal"]

func runway_weeks() -> int:
	if burn_per_week <= 0.0:
		return 999
	return int(floor(cash / burn_per_week))

func _format_money(amount: float) -> String:
	if amount >= 1_000_000_000.0:
		return "$%.2fB" % (amount / 1_000_000_000.0)
	elif amount >= 1_000_000.0:
		return "$%.2fM" % (amount / 1_000_000.0)
	elif amount >= 1_000.0:
		return "$%.1fK" % (amount / 1_000.0)
	else:
		return "$%.0f" % amount

func status_text() -> String:
	var lines: Array[String] = []
	var header := "Week %d | AP %d | Headcount %d" % [week, action_points, headcount()]
	if not company_name.is_empty():
		header = "%s — %s" % [company_name, header]
	lines.append(header)
	lines.append("Cash: $%.0f | Burn: $%.0f/week | Runway: %d weeks" % [cash, burn_per_week, runway_weeks()])
	lines.append("Users: %d | MRR: $%.0f" % [users, mrr])
	lines.append("Valuation: %s | Reputation: %.2f" % [_format_money(valuation), reputation])
	if investor_interest_weeks > 0:
		lines.append("Investors: interested (%dw left)" % investor_interest_weeks)
	if debt > 0.0:
		lines.append("Debt: $%.0f (%.0f%% weekly interest)" % [debt, debt_interest_rate * 100])
	if dilution > 0.0:
		lines.append("Dilution: %.1f%%" % dilution)
	if not active_offer.is_empty():
		lines.append("ACTIVE OFFER: %s wants to buy for %s — type 'sell' to accept" % [active_offer["buyer"], _format_money(active_offer["amount"])])
	return "\n".join(lines)

func stats_text() -> String:
	var ratio := 0.0
	if cac > 0.0:
		ratio = ltv / cac
	var lines: Array[String] = []
	lines.append("LTV: $%.0f | CAC: $%.0f | LTV/CAC: %.2f" % [ltv, cac, ratio])
	lines.append("Churn: %.2f | Product: %.1f | Tech Debt: %.1f" % [churn, product_progress, tech_debt])
	lines.append("Morale: %.2f | Brand: %.2f | Risk: %.2f" % [morale, brand, risk])
	lines.append("Reputation: %.2f" % reputation)
	return "\n".join(lines)

func end_summary_text(outcome: String) -> String:
	var ratio := 0.0
	if cac > 0.0:
		ratio = ltv / cac
	var lines: Array[String] = []
	lines.append("=".repeat(50))
	lines.append("RUN SUMMARY")
	lines.append("Outcome: %s" % outcome)
	lines.append("Week: %d" % week)
	lines.append("Cash: $%.0f | Burn: $%.0f/week | Runway: %d weeks" % [cash, burn_per_week, runway_weeks()])
	lines.append("Users: %d | MRR: $%.0f" % [users, mrr])
	lines.append("Product: %.1f | Churn: %.2f | LTV/CAC: %.2f" % [product_progress, churn, ratio])
	lines.append("Team: eng %d | gtm %d | hr %d | legal %d" % [team["engineer"], team["gtm"], team["hr"], team["legal"]])
	lines.append("Office: %s" % office_tier)
	lines.append("Features shipped: %d" % features_shipped.size())
	lines.append("Upgrades: %d" % active_upgrades.size())
	if debt > 0.0:
		lines.append("Debt: $%.0f (%.0f%% weekly interest)" % [debt, debt_interest_rate * 100])
	if dilution > 0.0:
		lines.append("Dilution: %.1f%%" % dilution)
	lines.append("Win targets: product>=80, LTV/CAC>=3, churn<=0.05")
	lines.append("=".repeat(50))
	return "\n".join(lines)

func list_hires_text() -> String:
	var rep_mod := _reputation_cost_modifier()
	var mod_label := ""
	if rep_mod < 1.0:
		mod_label = " (%.0f%% discount from reputation)" % ((1.0 - rep_mod) * 100)
	elif rep_mod > 1.0:
		mod_label = " (%.0f%% premium from low reputation)" % ((rep_mod - 1.0) * 100)
	var lines: Array[String] = []
	lines.append("Team%s" % mod_label)
	lines.append("Engineers: %d ($%.0f/week each)" % [team["engineer"], 800.0 * rep_mod])
	lines.append("GTM: %d ($%.0f/week each)" % [team["gtm"], 700.0 * rep_mod])
	lines.append("HR: %d ($%.0f/week each)" % [team["hr"], 600.0 * rep_mod])
	lines.append("Legal: %d ($%.0f/week each)" % [team["legal"], 900.0 * rep_mod])
	return "\n".join(lines)

func list_offices_text() -> String:
	var lines: Array[String] = []
	lines.append("Offices")
	lines.append("garage - $300/week")
	lines.append("coworking - $1200/week")
	lines.append("office - $3500/week")
	lines.append("Current: %s" % office_tier)
	return "\n".join(lines)

func list_features_text() -> String:
	if features_shipped.is_empty():
		return "No features shipped yet."
	var lines: Array[String] = []
	lines.append("Shipped Features")
	for f in features_shipped:
		lines.append("- %s" % f)
	return "\n".join(lines)

func list_upgrades_text() -> String:
	if active_upgrades.is_empty():
		return "No upgrades yet. You'll be offered upgrades every 5 weeks."
	var lines: Array[String] = []
	lines.append("Active Upgrades")
	for u in active_upgrades:
		lines.append("- %s" % u)
	return "\n".join(lines)

func inspect_text(thing: String) -> String:
	var key := thing.strip_edges().to_lower()
	if features_shipped.has(key):
		return "Feature '%s' is live and driving progress." % key
	if team.has(key):
		return "%s count: %d" % [key, team[key]]
	if key == "office":
		return "Current office: %s" % office_tier
	if key == "runway":
		return "Runway: %d weeks" % runway_weeks()
	if key == "company":
		return status_text() + "\n" + stats_text()
	if key == "valuation":
		return "Valuation: %s (dilution: %.1f%%)" % [_format_money(valuation), dilution]
	if key == "reputation":
		var desc := "neutral"
		if reputation >= 0.7:
			desc = "excellent — top talent wants to work here"
		elif reputation >= 0.5:
			desc = "solid — hiring is normal"
		elif reputation >= 0.3:
			desc = "shaky — candidates are hesitant"
		else:
			desc = "toxic — you have to overpay to hire anyone"
		return "Reputation: %.2f (%s)" % [reputation, desc]
	if key == "debt":
		if debt <= 0.0:
			return "No outstanding debt."
		return "Debt: $%.0f at %.0f%% weekly interest. Weekly interest cost: $%.0f" % [debt, debt_interest_rate * 100, debt * debt_interest_rate]
	return "Nothing to inspect for '%s'." % key

func _reputation_cost_modifier() -> float:
	if reputation >= 0.7:
		return 0.85
	elif reputation < 0.3:
		return 1.20
	return 1.0
