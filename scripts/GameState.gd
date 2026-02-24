extends Node

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
var team := {
	"engineer": 0,
	"gtm": 0,
	"hr": 0
}
var office_tier: String = "garage"
var office_rent: float = 300.0
var features_shipped: Array[String] = []
var campaigns: Array[String] = []

func runway_weeks() -> int:
	if burn_per_week <= 0.0:
		return 999
	return int(floor(cash / burn_per_week))

func status_text() -> String:
	var lines: Array[String] = []
	lines.append("Week %d | AP %d" % [week, action_points])
	lines.append("Cash: $%.0f | Burn: $%.0f/week | Runway: %d weeks" % [cash, burn_per_week, runway_weeks()])
	lines.append("Users: %d | MRR: $%.0f" % [users, mrr])
	return "\n".join(lines)

func stats_text() -> String:
	var ratio := 0.0
	if cac > 0.0:
		ratio = ltv / cac
	var lines: Array[String] = []
	lines.append("LTV: $%.0f | CAC: $%.0f | LTV/CAC: %.2f" % [ltv, cac, ratio])
	lines.append("Churn: %.2f | Product: %.1f | Tech Debt: %.1f" % [churn, product_progress, tech_debt])
	lines.append("Morale: %.2f | Brand: %.2f | Risk: %.2f" % [morale, brand, risk])
	return "\n".join(lines)

func list_hires_text() -> String:
	var lines: Array[String] = []
	lines.append("Team")
	lines.append("Engineers: %d" % team["engineer"])
	lines.append("GTM: %d" % team["gtm"])
	lines.append("HR: %d" % team["hr"])
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
	return "Nothing to inspect for '%s'." % key
