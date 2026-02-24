extends Control

@onready var status_label: Label = $Layout/StatusPanel/Status
@onready var log_scroll: ScrollContainer = $Layout/LogPanel/Scroll
@onready var log: Label = $Layout/LogPanel/Scroll/Log
@onready var input: LineEdit = $Layout/InputPanel/Input
@onready var pause_menu: Control = $PauseMenu
@onready var resume_button: Button = $PauseMenu/Panel/VBox/ResumeButton
@onready var restart_button: Button = $PauseMenu/Panel/VBox/RestartButton
@onready var help_button: Button = $PauseMenu/Panel/VBox/HelpButton

var prompt_color := Color(0.85, 0.85, 0.85)
var user_color := Color(1.0, 1.0, 1.0)

func _ready() -> void:
	input.text_submitted.connect(_on_submit)
	CommandRouter.output.connect(_on_output)
	resume_button.pressed.connect(_on_resume_pressed)
	restart_button.pressed.connect(_on_restart_pressed)
	help_button.pressed.connect(_on_help_pressed)
	# Ensure terminal text is visible across platforms (HTML5 can differ in theme defaults).
	log.add_theme_color_override("font_color", prompt_color)
	input.grab_focus()
	_write_prompt("=== STARTUP WORLD ===")
	_write_prompt("Build your AI startup from garage to IPO.")
	_write_prompt("")
	_write_prompt("What's your name, founder?")
	_sync_pause_ui(true)
	_update_status_bar()

func _process(_delta: float) -> void:
	_sync_pause_ui(false)
	# Keep typing focus in the terminal input.
	if not input.has_focus():
		input.grab_focus()
	_update_status_bar()

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_IN:
		if is_instance_valid(input):
			input.grab_focus()

func _on_submit(text: String) -> void:
	var trimmed := text.strip_edges()
	if trimmed.is_empty():
		return
	_write_user("> " + trimmed)
	input.clear()
	CommandRouter.run(trimmed)
	_scroll_to_bottom()

func _on_output(text: String) -> void:
	_write_prompt(text)
	_scroll_to_bottom()
	_update_status_bar()

func _write_prompt(text: String) -> void:
	log.text += text + "\n"

func _write_user(text: String) -> void:
	log.text += text + "\n"

func _scroll_to_bottom() -> void:
	# Defer until layout updates so the scrollbar max is correct.
	await get_tree().process_frame
	var bar := log_scroll.get_v_scroll_bar()
	if is_instance_valid(bar):
		log_scroll.scroll_vertical = int(bar.max_value)

func _sync_pause_ui(force: bool) -> void:
	var should_show := GameState.paused
	if force or pause_menu.visible != should_show:
		pause_menu.visible = should_show
		# Keep the user's terminal usable/visible at all times.
		# The pause menu is a separate interaction layer.
		if not input.has_focus():
			input.grab_focus()

func _update_status_bar() -> void:
	var title := ""
	if not GameState.company_name.is_empty():
		title = GameState.company_name
	elif not GameState.founder_name.is_empty():
		title = "%s's startup" % GameState.founder_name
	else:
		title = "StartUpWorld"

	var cash_text := "$%.0f" % GameState.cash
	var base := "%s | Week %d | AP %d | Cash %s | Users %d | MRR $%.0f" % [
		title,
		GameState.week,
		GameState.action_points,
		cash_text,
		GameState.users,
		GameState.mrr
	]
	if GameState.paused:
		base += " | PAUSED"
	if GameState.game_over:
		base += " | GAME OVER"
	if GameState.game_won:
		base += " | YOU WIN"
	status_label.text = base

func _on_resume_pressed() -> void:
	CommandRouter.run("resume")
	_scroll_to_bottom()
	input.grab_focus()

func _on_restart_pressed() -> void:
	CommandRouter.run("restart")
	_scroll_to_bottom()
	input.grab_focus()

func _on_help_pressed() -> void:
	CommandRouter.run("help")
	_scroll_to_bottom()
	input.grab_focus()
