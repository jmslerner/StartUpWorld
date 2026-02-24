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
	var desc: String = _build_offer_description(picked)
	return "\n--- EVENT ---\n%s\n%s" % [picked["headline"], desc]

func _has_hr() -> bool:
	return GameState.team["hr"] >= 1

func _has_legal() -> bool:
	return GameState.team["legal"] >= 1

func _catalog() -> Array[Dictionary]:
	return [
		# ===== TEAM EVENTS =====
		{
			"id": "mass_poaching_event",
			"headline": "Competitor tries to poach your engineering team",
			"description": func() -> String:
				if _has_hr() and _has_legal():
					return "A competitor made aggressive offers, but HR and legal moved fast. You still lose a chunk of engineers."
				if _has_hr() or _has_legal():
					return "A competitor started a poaching spree. You manage some retention, but you lose engineers."
				return "A competitor made offers to half your engineering team. You have no HR/legal muscle to counter. It's a bloodbath.",
			"condition": func() -> bool:
				return GameState.team["engineer"] >= 4 and GameState.week >= 6 and not GameState.upgrade_competitor_immune,
			"apply": func() -> void:
				var engineers := GameState.team["engineer"]
				var loss := int(ceil(engineers * 0.5))
				if _has_hr() and _has_legal():
					loss = int(ceil(engineers * 0.35))
				elif _has_hr() or _has_legal():
					loss = int(ceil(engineers * 0.45))
				loss = clamp(loss, 1, engineers)
				GameState.team["engineer"] -= loss
				GameState.burn_per_week -= SimEngine._role_cost("engineer") * loss
				GameState.burn_per_week = max(0.0, GameState.burn_per_week)
				GameState.morale = clamp(GameState.morale - 0.10, 0.0, 1.0)
				GameState.reputation = clamp(GameState.reputation - 0.04, 0.0, 1.0)
				GameState.risk = clamp(GameState.risk + 0.06, 0.0, 1.0),
		},
		{
			"id": "engineer_poached",
			"headline": "Lead engineer poached by Google",
			"description": "Your best engineer just accepted an offer from Google. Team morale takes a hit.",
			"condition": func() -> bool: return GameState.team["engineer"] >= 1,
			"apply": func() -> void:
				GameState.team["engineer"] -= 1
				GameState.burn_per_week -= 800.0 * GameState._reputation_cost_modifier()
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
			"condition": func() -> bool: return GameState.week >= 3 and GameState.reputation >= 0.4,
			"apply": func() -> void:
				GameState.team["engineer"] += 1
				GameState.burn_per_week += 800.0 * GameState._reputation_cost_modifier()
				GameState.morale = clamp(GameState.morale + 0.04, 0.0, 1.0),
		},
		{
			"id": "star_dev_reputation",
			"headline": "Top-tier engineer heard great things about your culture",
			"description": "Your reputation precedes you. A senior engineer joins at a discount.",
			"condition": func() -> bool: return GameState.reputation >= 0.75,
			"apply": func() -> void:
				GameState.team["engineer"] += 1
				GameState.burn_per_week += 600.0
				GameState.morale = clamp(GameState.morale + 0.05, 0.0, 1.0)
				GameState.reputation = clamp(GameState.reputation + 0.02, 0.0, 1.0),
		},
		{
			"id": "team_viral_tweet",
			"headline": "Team member goes viral on Twitter",
			"description": "One of your team posted a thread about your product that blew up. Free marketing!",
			"condition": func() -> bool: return GameState.headcount() >= 2,
			"apply": func() -> void:
				GameState.brand = clamp(GameState.brand + 0.06, 0.0, 1.0)
				GameState.users += 15,
		},
		# ===== MARKET EVENTS =====
		{
			"id": "rent_doubles",
			"headline": "Rent spike — your landlord doubles the price",
			"description": "Your landlord " + '"' + "re-prices the market" + '"' + ". Office costs double overnight.",
			"condition": func() -> bool:
				return GameState.week >= 4 and GameState.office_rent >= 800.0,
			"apply": func() -> void:
				var old_rent := GameState.office_rent
				var new_rent := old_rent * 2.0
				GameState.office_rent = new_rent
				# burn_per_week already includes office_rent; apply the delta.
				GameState.burn_per_week += (new_rent - old_rent)
				GameState.morale = clamp(GameState.morale - 0.03, 0.0, 1.0)
				GameState.risk = clamp(GameState.risk + 0.03, 0.0, 1.0),
		},
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
			"condition": func() -> bool: return GameState.product_progress >= 20.0 and not GameState.upgrade_competitor_immune,
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
				GameState.users += 30
				GameState.reputation = clamp(GameState.reputation + 0.03, 0.0, 1.0),
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
		# ===== PRODUCT EVENTS =====
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
		# ===== FINANCIAL EVENTS =====
		{
			"id": "h1b_fee_hike",
			"headline": "H-1B compliance fees jump — international hiring gets expensive",
			"description": func() -> String:
				if _has_legal():
					return "Visa and compliance fees rise, but legal keeps the damage contained. Your burn still increases."
				return "Visa and compliance fees rise. International hiring gets expensive and your burn increases.",
			"condition": func() -> bool:
				return GameState.week >= 5 and GameState.team["engineer"] >= 2,
			"apply": func() -> void:
				var per_engineer := 120.0
				if _has_legal():
					per_engineer = 70.0
				GameState.burn_per_week += per_engineer * float(GameState.team["engineer"])
				GameState.risk = clamp(GameState.risk + 0.03, 0.0, 1.0),
		},
		{
			"id": "tax_audit",
			"headline": "Surprise tax audit",
			"description": "The IRS wants a word. Legal fees and back taxes cost you $2,000.",
			"condition": func() -> bool: return GameState.cash >= 10000.0,
			"apply": func() -> void:
				var cost := 2000.0
				if _has_legal():
					cost = 800.0
				GameState.cash -= cost * GameState.upgrade_legal_cost_mult,
		},
		{
			"id": "innovation_award",
			"headline": "Startup wins innovation award",
			"description": "You won a $5,000 prize at a startup competition. The team is pumped!",
			"condition": func() -> bool: return GameState.product_progress >= 30.0,
			"apply": func() -> void:
				GameState.cash += 5000.0
				GameState.brand = clamp(GameState.brand + 0.05, 0.0, 1.0)
				GameState.morale = clamp(GameState.morale + 0.05, 0.0, 1.0)
				GameState.reputation = clamp(GameState.reputation + 0.04, 0.0, 1.0),
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
		# ===== HR DRAMA EVENTS =====
		{
			"id": "sexual_harassment_complaint",
			"headline": "Sexual harassment complaint filed",
			"description": func() -> String:
				if _has_hr():
					return "HR investigates and handles it properly. Reputation takes a smaller hit."
				return "No HR department to handle it. The situation spirals. Massive reputation damage and a $5,000 settlement.",
			"condition": func() -> bool: return GameState.headcount() >= 10,
			"apply": func() -> void:
				if _has_hr():
					GameState.reputation = clamp(GameState.reputation - 0.06, 0.0, 1.0)
					GameState.morale = clamp(GameState.morale - 0.04, 0.0, 1.0)
					if not _has_legal():
						GameState.cash -= 2500.0 * GameState.upgrade_legal_cost_mult
				else:
					GameState.reputation = clamp(GameState.reputation - 0.12, 0.0, 1.0)
					GameState.morale = clamp(GameState.morale - 0.08, 0.0, 1.0)
					var cost := 5000.0
					if _has_legal():
						cost = 2500.0
					GameState.cash -= cost * GameState.upgrade_legal_cost_mult,
		},
		{
			"id": "workplace_bullying",
			"headline": "Workplace bullying report surfaces",
			"description": func() -> String:
				if _has_hr():
					return "HR documents the incident and addresses it. Morale dips but the situation is contained."
				return "Without HR, the bullying goes unchecked. An employee quits and word gets out.",
			"condition": func() -> bool: return GameState.headcount() >= 10,
			"apply": func() -> void:
				if _has_hr():
					GameState.morale = clamp(GameState.morale - 0.05, 0.0, 1.0)
					GameState.reputation = clamp(GameState.reputation - 0.03, 0.0, 1.0)
				else:
					GameState.morale = clamp(GameState.morale - 0.10, 0.0, 1.0)
					GameState.reputation = clamp(GameState.reputation - 0.08, 0.0, 1.0)
					# Lose a random employee if no legal to protect
					if not _has_legal():
						var roles := ["engineer", "gtm"]
						for r in roles:
							if GameState.team[r] > 0:
								GameState.team[r] -= 1
								GameState.burn_per_week -= SimEngine._role_cost(r)
								break,
		},
		{
			"id": "discrimination_lawsuit",
			"headline": "Discrimination lawsuit filed against the company",
			"description": func() -> String:
				if _has_hr() and _has_legal():
					return "Your HR records are clean and legal team mounts a strong defense. Minimal damage."
				elif _has_legal():
					return "Legal handles it but without HR documentation, it's an uphill battle."
				elif _has_hr():
					return "HR has documentation but no legal team. You settle for a painful amount."
				return "No HR, no legal. This is going to hurt. A lot.",
			"condition": func() -> bool: return GameState.headcount() >= 10 and GameState.week >= 8,
			"apply": func() -> void:
				var mult := GameState.upgrade_legal_cost_mult
				if _has_hr() and _has_legal():
					GameState.cash -= 1500.0 * mult
					GameState.reputation = clamp(GameState.reputation - 0.03, 0.0, 1.0)
				elif _has_legal():
					GameState.cash -= 4000.0 * mult
					GameState.reputation = clamp(GameState.reputation - 0.06, 0.0, 1.0)
					GameState.brand = clamp(GameState.brand - 0.03, 0.0, 1.0)
				elif _has_hr():
					GameState.cash -= 6000.0 * mult
					GameState.reputation = clamp(GameState.reputation - 0.07, 0.0, 1.0)
					GameState.brand = clamp(GameState.brand - 0.04, 0.0, 1.0)
				else:
					GameState.cash -= 10000.0 * mult
					GameState.reputation = clamp(GameState.reputation - 0.10, 0.0, 1.0)
					GameState.brand = clamp(GameState.brand - 0.05, 0.0, 1.0),
		},
		{
			"id": "hostile_work_environment",
			"headline": "Hostile work environment claim goes public",
			"description": func() -> String:
				if _has_hr():
					return "HR's policies help contain the fallout. Minor brand damage."
				return "Glassdoor reviews tank. Candidates are ghosting your recruiters.",
			"condition": func() -> bool: return GameState.headcount() >= 12,
			"apply": func() -> void:
				if _has_hr():
					GameState.brand = clamp(GameState.brand - 0.03, 0.0, 1.0)
					GameState.reputation = clamp(GameState.reputation - 0.04, 0.0, 1.0)
				else:
					GameState.brand = clamp(GameState.brand - 0.08, 0.0, 1.0)
					GameState.reputation = clamp(GameState.reputation - 0.10, 0.0, 1.0)
					if not _has_legal():
						GameState.churn = clamp(GameState.churn + 0.02, 0.01, 0.2),
		},
		{
			"id": "wrongful_termination_suit",
			"headline": "Former employee files wrongful termination suit",
			"description": func() -> String:
				if _has_legal():
					return "Your legal team handles the case efficiently. Small settlement."
				return "Without legal counsel, this drags on and costs you dearly.",
			"condition": func() -> bool: return GameState.headcount() >= 8 and GameState.fired_recently,
			"apply": func() -> void:
				var mult := GameState.upgrade_legal_cost_mult
				if _has_hr() and _has_legal():
					GameState.cash -= 1000.0 * mult
					GameState.reputation = clamp(GameState.reputation - 0.02, 0.0, 1.0)
				elif _has_legal():
					GameState.cash -= 2000.0 * mult
					GameState.reputation = clamp(GameState.reputation - 0.03, 0.0, 1.0)
				elif _has_hr():
					GameState.cash -= 5000.0 * mult
					GameState.reputation = clamp(GameState.reputation - 0.06, 0.0, 1.0)
				else:
					GameState.cash -= 8000.0 * mult
					GameState.reputation = clamp(GameState.reputation - 0.08, 0.0, 1.0),
		},
		# ===== VC ANTAGONIST EVENTS =====
		{
			"id": "cofounder_twitter_fight",
			"headline": "Cofounder starts a social media fight",
			"description": func() -> String:
				if GameState.cofounder == "operator":
					return "Your operator cofounder picks a public fight with another founder. Screenshots spread."
				return "Your technical cofounder rage-posts a thread about " + '"' + "vibes" + '"' + " and " + '"' + "fraud" + '"' + ". It doesn't land.",
			"condition": func() -> bool:
				return GameState.week >= 4 and GameState.setup_complete and GameState.brand >= 0.15,
			"apply": func() -> void:
				var rep_hit := 0.06
				var brand_hit := 0.05
				var cash_hit := 0.0
				if _has_hr():
					rep_hit *= 0.75
					brand_hit *= 0.85
				if _has_legal():
					rep_hit *= 0.85
					cash_hit = 1500.0 * GameState.upgrade_legal_cost_mult
				GameState.reputation = clamp(GameState.reputation - rep_hit, 0.0, 1.0)
				GameState.brand = clamp(GameState.brand - brand_hit, 0.0, 1.0)
				GameState.morale = clamp(GameState.morale - 0.05, 0.0, 1.0)
				GameState.risk = clamp(GameState.risk + 0.05, 0.0, 1.0)
				if cash_hit > 0.0:
					GameState.cash -= cash_hit,
		},
		{
			"id": "vc_board_seat",
			"headline": "VC demands a board seat",
			"description": "Your lead investor wants more control. They're pushing for a board seat and veto rights.",
			"condition": func() -> bool: return GameState.cash >= 50000.0 and GameState.week >= 6,
			"apply": func() -> void:
				GameState.risk = clamp(GameState.risk + 0.08, 0.0, 1.0)
				GameState.morale = clamp(GameState.morale - 0.05, 0.0, 1.0),
		},
		{
			"id": "vc_premature_scaling",
			"headline": "VC pushes for premature scaling",
			"description": "Your investors want 'hockey stick growth.' They pressure you to hire aggressively. Burn jumps $1,000/week.",
			"condition": func() -> bool: return GameState.cash >= 30000.0 and GameState.headcount() >= 4,
			"apply": func() -> void:
				GameState.burn_per_week += 1000.0
				GameState.risk = clamp(GameState.risk + 0.05, 0.0, 1.0),
		},
		{
			"id": "vc_down_round",
			"headline": "VC threatens a down round",
			"description": "Your investors are unhappy with progress. They're talking about a down round — your equity would get crushed.",
			"condition": func() -> bool: return GameState.risk >= 0.4 and GameState.valuation > 0.0,
			"apply": func() -> void:
				GameState.morale = clamp(GameState.morale - 0.08, 0.0, 1.0)
				GameState.reputation = clamp(GameState.reputation - 0.05, 0.0, 1.0)
				GameState.brand = clamp(GameState.brand - 0.03, 0.0, 1.0),
		},
		{
			"id": "vc_leaks_metrics",
			"headline": "VC leaks your metrics to a competitor",
			"description": "Someone on your cap table shared your board deck. A competitor now knows your numbers.",
			"condition": func() -> bool: return GameState.risk >= 0.3,
			"apply": func() -> void:
				GameState.brand = clamp(GameState.brand - 0.06, 0.0, 1.0)
				GameState.churn = clamp(GameState.churn + 0.01, 0.01, 0.2)
				GameState.reputation = clamp(GameState.reputation - 0.04, 0.0, 1.0),
		},
		# ===== PE / BIG TECH ACQUISITION OFFERS =====
		{
			"id": "pe_offer",
			"headline": "PE firm circling your company",
			"description": "",
			"condition": func() -> bool: return GameState.valuation >= 500000.0 and GameState.active_offer.is_empty(),
			"apply": func() -> void:
				var offer_amount := GameState.valuation * 1.3
				GameState.active_offer = {"buyer": "Apex Capital Partners", "amount": offer_amount},
		},
		{
			"id": "google_offer",
			"headline": "Google wants to acquire your company",
			"description": "",
			"condition": func() -> bool: return GameState.valuation >= 5_000_000_000.0 and GameState.active_offer.is_empty(),
			"apply": func() -> void:
				var offer_amount := GameState.valuation * 1.5
				GameState.active_offer = {"buyer": "Google", "amount": offer_amount},
		},
		{
			"id": "meta_offer",
			"headline": "Meta makes an acquisition offer",
			"description": "",
			"condition": func() -> bool: return GameState.valuation >= 5_000_000_000.0 and GameState.active_offer.is_empty(),
			"apply": func() -> void:
				var offer_amount := GameState.valuation * 1.4
				GameState.active_offer = {"buyer": "Meta", "amount": offer_amount},
		},
		{
			"id": "oracle_offer",
			"headline": "Oracle offers to buy your company",
			"description": "",
			"condition": func() -> bool: return GameState.valuation >= 5_000_000_000.0 and GameState.active_offer.is_empty(),
			"apply": func() -> void:
				var offer_amount := GameState.valuation * 1.2
				GameState.active_offer = {"buyer": "Oracle", "amount": offer_amount},
		},
	]

# Override description for acquisition offers (dynamic text)
func _build_offer_description(picked: Dictionary) -> String:
	if picked["id"] in ["pe_offer", "google_offer", "meta_offer", "oracle_offer"]:
		var buyer: String = GameState.active_offer.get("buyer", "???")
		var amount: float = GameState.active_offer.get("amount", 0.0)
		return "%s offers %s for your company. Type 'sell' to accept or ignore to decline." % [buyer, GameState._format_money(amount)]
	var desc = picked["description"]
	if desc is Callable:
		return desc.call()
	return desc
