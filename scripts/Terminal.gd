extends Control

@onready var layout: VBoxContainer = $Layout
@onready var status_panel: PanelContainer = $Layout/StatusPanel
@onready var status_label: Label = $Layout/StatusPanel/Status
@onready var log_panel: PanelContainer = $Layout/LogPanel
@onready var log_scroll: ScrollContainer = $Layout/LogPanel/Scroll
@onready var log: Label = $Layout/LogPanel/Scroll/Log
@onready var input_panel: PanelContainer = $Layout/InputPanel
@onready var input: LineEdit = $Layout/InputPanel/Input
@onready var pause_menu: Control = $PauseMenu
@onready var resume_button: Button = $PauseMenu/Panel/VBox/ResumeButton
@onready var restart_button: Button = $PauseMenu/Panel/VBox/RestartButton
@onready var help_button: Button = $PauseMenu/Panel/VBox/HelpButton

var prompt_color := Color(0.85, 0.85, 0.85)
var user_color := Color(1.0, 1.0, 1.0)
var _input_box_normal: StyleBoxFlat
var _input_box_focus: StyleBoxFlat
var _status_box: StyleBoxFlat

func _ready() -> void:
	input.text_submitted.connect(_on_submit)
	CommandRouter.output.connect(_on_output)
	resume_button.pressed.connect(_on_resume_pressed)
	restart_button.pressed.connect(_on_restart_pressed)
	help_button.pressed.connect(_on_help_pressed)
	input.focus_entered.connect(_on_input_focus_changed)
	input.focus_exited.connect(_on_input_focus_changed)
	# Ensure terminal text is visible across platforms (HTML5 can differ in theme defaults).
	log.add_theme_color_override("font_color", prompt_color)
	# Prevent the log label from ever collapsing to 0 height (can happen inside ScrollContainer on some platforms).
	log.custom_minimum_size = Vector2(0, 1)
	_apply_theme_overrides()
	_apply_responsive_layout()
	get_viewport().size_changed.connect(_on_viewport_resized)
	input.grab_focus()
	_write_prompt("=== STARTUP WORLD ===")
	_write_prompt("Build your AI startup from garage to IPO.")
	_write_prompt("")
	_write_prompt("What's your name, founder?")
	# On web, the canvas/layout can report a width of 0 during _ready(), which makes
	# the Label minimum size compute as 0 and the log area appear blank.
	call_deferred("_refresh_log_layout")
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

func _apply_theme_overrides() -> void:
	_status_box = StyleBoxFlat.new()
	_status_box.bg_color = Color(0.18, 0.18, 0.18, 1)
	_status_box.border_color = Color(0.35, 0.35, 0.35, 1)
	_status_box.border_width_all = 1
	_status_box.corner_radius_top_left = 6
	_status_box.corner_radius_top_right = 6
	_status_box.corner_radius_bottom_left = 6
	_status_box.corner_radius_bottom_right = 6
	status_panel.add_theme_stylebox_override("panel", _status_box)
	status_label.add_theme_color_override("font_color", Color(0.95, 0.95, 0.95, 1))

	var log_box := StyleBoxFlat.new()
	log_box.bg_color = Color(0.12, 0.12, 0.12, 1)
	log_box.border_color = Color(0.35, 0.35, 0.35, 1)
	log_box.border_width_all = 1
	log_box.corner_radius_top_left = 6
	log_box.corner_radius_top_right = 6
	log_box.corner_radius_bottom_left = 6
	log_box.corner_radius_bottom_right = 6
	log_panel.add_theme_stylebox_override("panel", log_box)

	_input_box_normal = StyleBoxFlat.new()
	_input_box_normal.bg_color = Color(0.10, 0.10, 0.10, 1)
	_input_box_normal.border_color = Color(0.45, 0.45, 0.45, 1)
	_input_box_normal.border_width_all = 1
	_input_box_normal.corner_radius_top_left = 6
	_input_box_normal.corner_radius_top_right = 6
	_input_box_normal.corner_radius_bottom_left = 6
	_input_box_normal.corner_radius_bottom_right = 6

	_input_box_focus = _input_box_normal.duplicate()
	_input_box_focus.border_color = Color(0.90, 0.90, 0.90, 1)
	_input_box_focus.border_width_all = 2

	input_panel.add_theme_stylebox_override("panel", _input_box_normal)

func _apply_responsive_layout() -> void:
	var width := get_viewport_rect().size.x
	var margin := 16.0
	var log_font_size := 16
	var status_font_size := 16
	var input_font_size := 16
	var line_spacing := 4
	var status_height := 36.0
	if width < 720.0:
		margin = 12.0
		log_font_size = 15
		status_font_size = 14
		input_font_size = 15
		line_spacing = 3
		status_height = 32.0
	if width < 480.0:
		margin = 10.0
		log_font_size = 14
		status_font_size = 13
		input_font_size = 14
		line_spacing = 2
		status_height = 30.0

	layout.offset_left = margin
	layout.offset_top = margin
	layout.offset_right = -margin
	layout.offset_bottom = -margin
	log.add_theme_font_size_override("font_size", log_font_size)
	log.add_theme_constant_override("line_spacing", line_spacing)
	status_label.add_theme_font_size_override("font_size", status_font_size)
	input.add_theme_font_size_override("font_size", input_font_size)
	status_panel.custom_minimum_size = Vector2(0, status_height)

func _on_viewport_resized() -> void:
	_apply_responsive_layout()
	_refresh_log_layout()

func _refresh_log_layout() -> void:
	await get_tree().process_frame
	_update_log_size()
	_scroll_to_bottom()

func _on_input_focus_changed() -> void:
	if input.has_focus():
		input_panel.add_theme_stylebox_override("panel", _input_box_focus)
	else:
		input_panel.add_theme_stylebox_override("panel", _input_box_normal)

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
	_update_log_size()

func _write_user(text: String) -> void:
	log.text += text + "\n"
	_update_log_size()

func _scroll_to_bottom() -> void:
	# Defer until layout updates so the scrollbar max is correct.
	await get_tree().process_frame
	var bar := log_scroll.get_v_scroll_bar()
	if is_instance_valid(bar):
		log_scroll.scroll_vertical = int(bar.max_value)

func _update_log_size() -> void:
	# Ensure the label grows to fit content so the ScrollContainer can scroll.
	var min_size := log.get_combined_minimum_size()
	log.custom_minimum_size = Vector2(min_size.x, maxf(min_size.y, 1.0))

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
