extends Node

signal output(text: String)

var _onboarding_step: int = 0  # 0=name, 1=company, 2=archetype, 3=cofounder

func run(text: String) -> void:
	var input := text.strip_edges()
	if input.is_empty():
		return
	if not GameState.setup_complete:
		_handle_onboarding(input)
		return
	if GameState.game_over:
		_emit("Game is over. Restart to play again.")
		return
	if not GameState.pending_upgrade.is_empty():
		_handle_upgrade_choice(input)
		return
	var tokens := _tokenize(input)
	if tokens.is_empty():
		return
	var command := tokens[0]
	match command:
		"help":
			_emit(_help_text())
		"status":
			_emit(GameState.status_text())
		"stats":
			_emit(GameState.stats_text())
		"list":
			_handle_list(tokens)
		"inspect":
			_emit(GameState.inspect_text(_rest(tokens, 1)))
		"hire":
			_emit(SimEngine.hire_role(_canonical(tokens, 1)))
		"fire":
			_emit(SimEngine.fire_target(_canonical(tokens, 1)))
		"rent":
			_emit(SimEngine.rent_office(_canonical(tokens, 2)))
		"ship":
			_emit(SimEngine.ship_feature(_rest(tokens, 2)))
		"refactor":
			_emit(SimEngine.refactor())
		"launch":
			_emit(SimEngine.launch_campaign(_rest(tokens, 2)))
		"outreach":
			_emit(SimEngine.enterprise_outreach())
		"pitch":
			_emit(SimEngine.pitch_investors())
		"raise":
			_handle_raise(tokens)
		"borrow":
			_handle_borrow(tokens)
		"safe":
			_handle_safe(tokens)
		"mortgage":
			_emit(SimEngine.mortgage_house())
		"friends":
			_handle_friends(tokens)
		"sell":
			_emit(SimEngine.sell_company())
		"ipo":
			_emit(SimEngine.ipo())
		"cut":
			_emit(SimEngine.cut_costs())
		"end":
			_emit(SimEngine.end_week())
			_check_win_loss()
		_:
			_emit("Unknown command. Type 'help'.")

func _handle_onboarding(input: String) -> void:
	match _onboarding_step:
		0:
			GameState.founder_name = input
			_emit("Nice to meet you, %s." % input)
			_emit("")
			_emit("What's your company called?")
			_onboarding_step = 1
		1:
			GameState.company_name = input
			_emit("%s — I like it." % input)
			_emit("")
			_emit("What kind of AI startup are you building?")
			_emit("  1) B2B SaaS  — slow growth at first, but massive enterprise contracts")
			_emit("  2) B2C       — fast user growth, but thin margins")
			_emit("")
			_emit("Type '1' or '2':")
			_onboarding_step = 2
		2:
			var choice := input.to_lower().strip_edges()
			if choice in ["1", "b2b", "b2b saas"]:
				GameState.archetype = "b2b"
				_emit("B2B SaaS it is. Enterprise contracts take time, but they pay.")
			elif choice in ["2", "b2c", "b2c ai"]:
				GameState.archetype = "b2c"
				_emit("B2C AI. Move fast, grow fast, figure out margins later.")
			else:
				_emit("Type '1' for B2B SaaS or '2' for B2C:")
				return
			_emit("")
			_emit("Choose your cofounder:")
			_emit("  1) Technical cofounder — attracts engineering talent, ships faster")
			_emit("  2) Operator cofounder  — sales machine, finds customers and GTM talent")
			_emit("")
			_emit("Type '1' or '2':")
			_onboarding_step = 3
		3:
			var choice := input.to_lower().strip_edges()
			if choice in ["1", "technical", "tech"]:
				GameState.cofounder = "technical"
			elif choice in ["2", "operator", "ops", "operations"]:
				GameState.cofounder = "operator"
			else:
				_emit("Type '1' for Technical or '2' for Operator:")
				return
			_emit(GameState.apply_setup())

func _handle_upgrade_choice(input: String) -> void:
	var choice := input.strip_edges()
	if choice in ["1", "2", "3"]:
		_emit(SimEngine.apply_upgrade(int(choice) - 1))
	else:
		_emit("Choose an upgrade. Type 1, 2, or 3:")

func _handle_list(tokens: Array) -> void:
	if tokens.size() < 2:
		_emit("List what? hires, offices, features, upgrades")
		return
	match tokens[1]:
		"hires":
			_emit(GameState.list_hires_text())
		"offices":
			_emit(GameState.list_offices_text())
		"features":
			_emit(GameState.list_features_text())
		"upgrades":
			_emit(GameState.list_upgrades_text())
		_:
			_emit("Unknown list category.")

func _handle_raise(tokens: Array) -> void:
	if tokens.size() < 3:
		_emit("Usage: raise seed 500k")
		return
	var round_name := tokens[1]
	var amount := _parse_amount(tokens[2])
	_emit(SimEngine.raise_round(round_name, amount))

func _handle_borrow(tokens: Array) -> void:
	if tokens.size() < 2:
		_emit("Usage: borrow 50k")
		return
	var amount := _parse_amount(tokens[1])
	_emit(SimEngine.borrow(amount))

func _handle_safe(tokens: Array) -> void:
	if tokens.size() < 2:
		_emit("Usage: safe 100k")
		return
	var amount := _parse_amount(tokens[1])
	_emit(SimEngine.raise_safe(amount))

func _handle_friends(tokens: Array) -> void:
	if tokens.size() < 2:
		_emit("Usage: friends 10k")
		return
	var amount := _parse_amount(tokens[1])
	_emit(SimEngine.borrow_friends(amount))

func _check_win_loss() -> void:
	if GameState.cash <= 0.0:
		GameState.game_over = true
		_emit("GAME OVER: You ran out of cash.")
		if GameState.house_mortgaged:
			_emit("...and you lost your house too.")
		if GameState.friends_borrowed:
			_emit("...and you still owe your friends money.")

func _tokenize(text: String) -> Array:
	var parts := text.to_lower().split(" ", false)
	var tokens: Array = []
	for p in parts:
		if p != "":
			tokens.append(_canonical_word(p))
	return tokens

func _canonical(tokens: Array, index: int) -> String:
	if tokens.size() <= index:
		return ""
	return _canonical_word(str(tokens[index]))

func _canonical_word(word: String) -> String:
	match word:
		"eng", "dev":
			return "engineer"
		"marketing":
			return "gtm"
		"people":
			return "hr"
		"lawyer", "counsel", "attorneys":
			return "legal"
		"workspace":
			return "office"
		"cowork":
			return "coworking"
		_:
			return word

func _rest(tokens: Array, start: int) -> String:
	if tokens.size() <= start:
		return ""
	var slice := []
	for i in range(start, tokens.size()):
		slice.append(tokens[i])
	return " ".join(slice)

func _parse_amount(text: String) -> float:
	var t := text.strip_edges().to_lower()
	var mult := 1.0
	if t.ends_with("k"):
		mult = 1000.0
		t = t.substr(0, t.length() - 1)
	elif t.ends_with("m"):
		mult = 1000000.0
		t = t.substr(0, t.length() - 1)
	var value := float(t)
	return value * mult

func _help_text() -> String:
	var lines: Array[String] = []
	lines.append("=== Commands ===")
	lines.append("")
	lines.append("INFO")
	lines.append("  help, status, stats")
	lines.append("  list hires|offices|features|upgrades")
	lines.append("  inspect <thing>")
	lines.append("")
	lines.append("TEAM")
	lines.append("  hire engineer|gtm|hr|legal")
	lines.append("  fire <role>")
	lines.append("")
	lines.append("PRODUCT")
	lines.append("  ship feature <name>")
	lines.append("  refactor")
	lines.append("  rent office garage|coworking|office")
	lines.append("")
	lines.append("GROWTH")
	lines.append("  launch campaign <name>")
	lines.append("  outreach")
	lines.append("")
	lines.append("FUNDING")
	lines.append("  pitch investors")
	lines.append("  raise seed <amount>")
	lines.append("  borrow <amount>        — bank loan (5% weekly interest)")
	lines.append("  safe <amount>          — SAFE note (dilutes equity)")
	lines.append("  mortgage house         — $50k one-time (personal risk)")
	lines.append("  friends <amount>       — up to $15k one-time")
	lines.append("")
	lines.append("OPERATIONS")
	lines.append("  cut costs")
	lines.append("  end                    — end week")
	lines.append("")
	lines.append("ENDGAME")
	lines.append("  sell                   — accept acquisition offer")
	lines.append("  ipo                    — go public ($1B+ valuation required)")
	return "\n".join(lines)

func _emit(text: String) -> void:
	emit_signal("output", text)
