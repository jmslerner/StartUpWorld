extends Node

signal output(text: String)

func run(text: String) -> void:
	var input := text.strip_edges()
	if input.is_empty():
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
		"cut":
			_emit(SimEngine.cut_costs())
		"end":
			_emit(SimEngine.end_week())
			_check_win_loss()
		_:
			_emit("Unknown command. Type 'help'.")

func _handle_list(tokens: Array) -> void:
	if tokens.size() < 2:
		_emit("List what? hires, offices, features")
		return
	match tokens[1]:
		"hires":
			_emit(GameState.list_hires_text())
		"offices":
			_emit(GameState.list_offices_text())
		"features":
			_emit(GameState.list_features_text())
		_:
			_emit("Unknown list category.")

func _handle_raise(tokens: Array) -> void:
	if tokens.size() < 3:
		_emit("Usage: raise seed 500k")
		return
	var round_name := tokens[1]
	var amount := _parse_amount(tokens[2])
	_emit(SimEngine.raise_round(round_name, amount))

func _check_win_loss() -> void:
	if GameState.cash <= 0.0:
		_emit("Game over: you ran out of cash.")
		return
	var ratio := 0.0
	if GameState.cac > 0.0:
		ratio = GameState.ltv / GameState.cac
	if GameState.product_progress >= 80.0 and ratio >= 3.0 and GameState.churn <= 0.05:
		_emit("You win: product-market fit achieved.")

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
	lines.append("Commands")
	lines.append("help, status, stats")
	lines.append("list hires|offices|features")
	lines.append("inspect <thing>")
	lines.append("hire engineer|gtm|hr")
	lines.append("fire <role>")
	lines.append("rent office garage|coworking|office")
	lines.append("ship feature <name>")
	lines.append("refactor")
	lines.append("launch campaign <name>")
	lines.append("outreach")
	lines.append("pitch investors")
	lines.append("raise seed <amount>")
	lines.append("cut costs")
	lines.append("end")
	return "\n".join(lines)

func _emit(text: String) -> void:
	emit_signal("output", text)
