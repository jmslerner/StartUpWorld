extends Node

var rng := RandomNumberGenerator.new()
var last_event_id: String = ""

func _ready() -> void:
	rng.seed = 42

func roll_event() -> String:
	if rng.randi_range(0, 100) < 50:
		return ""
	var eligible: Array[Dictionary] = []
	for e in _catalog():
		if e["id"] != last_event_id and e["condition"].call():
			eligible.append(e)
	if eligible.is_empty():
		return ""
	var picked: Dictionary = eligible[rng.randi_range(0, eligible.size() - 1)]
	last_event_id = picked["id"]
	picked["apply"].call()
	return "\n--- EVENT ---\n%s\n%s" % [picked["headline"], picked["description"]]

func _catalog() -> Array[Dictionary]:
	return [
		# ---- Team Events ----
		{
			"id": "engineer_poached",
			"headline": "Lead engineer poached by Google",
			"description": "Your best engineer just accepted an offer from Google. Team morale takes a hit.",
			"condition": func() -> bool: return GameState.team["engineer"] >= 1,
			"apply": func() -> void:
				GameState.team["engineer"] -= 1
				GameState.burn_per_week -= 800.0
				GameState.morale = clamp(GameState.morale - 0.08, 0.0, 1.0),
		},
		{
			"id": "engineering_walkout",
			"headline": "Engineering walkout over crunch culture",
			"description": "Your engineers staged a walkout. Product progress stalls and tech debt piles up.",
			"condition": func() -> bool: return GameState.team["engineer"] >= 2 and GameState.morale < 0.4,
			"apply": func() -> void:
				GameState.product_progress = clamp(GameState.product_progress - 5.0, 0.0, 100.0)
				GameState.tech_debt = clamp(GameState.tech_debt + 4.0, 0.0, 100.0)
				GameState.morale = clamp(GameState.morale - 0.10, 0.0, 1.0),
		},
		{
			"id": "star_developer_applies",
			"headline": "Star developer wants to join your mission",
			"description": "A talented engineer saw your product and applied. You hire them on the spot.",
			"condition": func() -> bool: return GameState.week >= 3,
			"apply": func() -> void:
				GameState.team["engineer"] += 1
				GameState.burn_per_week += 800.0
				GameState.morale = clamp(GameState.morale + 0.04, 0.0, 1.0),
		},
		{
			"id": "team_viral_tweet",
			"headline": "Team member goes viral on Twitter",
			"description": "One of your team posted a thread about your product that blew up. Free marketing!",
			"condition": func() -> bool:
				var total: int = GameState.team["engineer"] + GameState.team["gtm"] + GameState.team["hr"]
				return total >= 2,
			"apply": func() -> void:
				GameState.brand = clamp(GameState.brand + 0.06, 0.0, 1.0)
				GameState.users += 15,
		},
		# ---- Market Events ----
		{
			"id": "gpu_price_spike",
			"headline": "GPU prices spike — compute costs surge",
			"description": "NVIDIA supply crunch hits the market. Your cloud bill jumps $500/week.",
			"condition": func() -> bool: return GameState.week >= 2,
			"apply": func() -> void:
				GameState.burn_per_week += 500.0,
		},
		{
			"id": "enterprise_client_churns",
			"headline": "Enterprise client doesn't renew",
			"description": "Your biggest B2B client just churned — that was 25% of revenue. Ouch.",
			"condition": func() -> bool: return GameState.mrr >= 1000.0,
			"apply": func() -> void:
				GameState.mrr *= 0.75
				GameState.users = max(0, GameState.users - 15)
				GameState.risk = clamp(GameState.risk + 0.05, 0.0, 1.0),
		},
		{
			"id": "competitor_launches",
			"headline": "Competitor launches similar product",
			"description": "A well-funded competitor just shipped a clone of your core feature. Churn ticks up.",
			"condition": func() -> bool: return GameState.product_progress >= 20.0,
			"apply": func() -> void:
				GameState.churn = clamp(GameState.churn + 0.02, 0.01, 0.2)
				GameState.brand = clamp(GameState.brand - 0.05, 0.0, 1.0),
		},
		{
			"id": "positive_press",
			"headline": "TechCrunch writes a glowing profile",
			"description": "A journalist covered your startup. Signups surge overnight.",
			"condition": func() -> bool: return GameState.brand >= 0.15,
			"apply": func() -> void:
				GameState.brand = clamp(GameState.brand + 0.10, 0.0, 1.0)
				GameState.users += 30,
		},
		{
			"id": "market_downturn",
			"headline": "Market downturn — investors tighten belts",
			"description": "VC funding dries up across the board. Fundraising just got harder.",
			"condition": func() -> bool: return GameState.week >= 4,
			"apply": func() -> void:
				GameState.risk = clamp(GameState.risk + 0.10, 0.0, 1.0)
				GameState.morale = clamp(GameState.morale - 0.03, 0.0, 1.0),
		},
		# ---- Product Events ----
		{
			"id": "security_vulnerability",
			"headline": "Critical security vulnerability discovered",
			"description": "A white-hat hacker found an exploit in your app. Users are spooked.",
			"condition": func() -> bool: return GameState.features_shipped.size() >= 1,
			"apply": func() -> void:
				GameState.tech_debt = clamp(GameState.tech_debt + 5.0, 0.0, 100.0)
				GameState.users = max(0, GameState.users - 10)
				GameState.brand = clamp(GameState.brand - 0.04, 0.0, 1.0),
		},
		{
			"id": "feature_goes_viral",
			"headline": "Feature goes viral on Hacker News",
			"description": "Your latest feature hit the front page of HN. Servers are melting (in a good way).",
			"condition": func() -> bool: return GameState.features_shipped.size() >= 2,
			"apply": func() -> void:
				GameState.users += 50
				GameState.brand = clamp(GameState.brand + 0.08, 0.0, 1.0),
		},
		{
			"id": "server_outage",
			"headline": "Server outage — customers furious",
			"description": "Your app went down for 6 hours. Twitter is on fire (not the good kind).",
			"condition": func() -> bool: return GameState.users >= 80,
			"apply": func() -> void:
				GameState.churn = clamp(GameState.churn + 0.03, 0.01, 0.2)
				GameState.brand = clamp(GameState.brand - 0.06, 0.0, 1.0)
				GameState.morale = clamp(GameState.morale - 0.04, 0.0, 1.0),
		},
		# ---- Financial Events ----
		{
			"id": "tax_audit",
			"headline": "Surprise tax audit",
			"description": "The IRS wants a word. Legal fees and back taxes cost you $2,000.",
			"condition": func() -> bool: return GameState.cash >= 10000.0,
			"apply": func() -> void:
				GameState.cash -= 2000.0,
		},
		{
			"id": "innovation_award",
			"headline": "Startup wins innovation award",
			"description": "You won a $5,000 prize at a startup competition. The team is pumped!",
			"condition": func() -> bool: return GameState.product_progress >= 30.0,
			"apply": func() -> void:
				GameState.cash += 5000.0
				GameState.brand = clamp(GameState.brand + 0.05, 0.0, 1.0)
				GameState.morale = clamp(GameState.morale + 0.05, 0.0, 1.0),
		},
		{
			"id": "angel_unsolicited",
			"headline": "Angel investor slides into your DMs",
			"description": "An angel investor loved your demo and wired $8,000. No strings attached.",
			"condition": func() -> bool: return GameState.brand >= 0.3,
			"apply": func() -> void:
				GameState.cash += 8000.0
				GameState.risk = clamp(GameState.risk - 0.03, 0.0, 1.0),
		},
	]
