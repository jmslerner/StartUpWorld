extends Control

@onready var log: RichTextLabel = $Log
@onready var input: LineEdit = $Input
@onready var input_glow: ColorRect = $InputGlow
@onready var pause_menu: Control = $PauseMenu
@onready var resume_button: Button = $PauseMenu/Panel/VBox/ResumeButton
@onready var restart_button: Button = $PauseMenu/Panel/VBox/RestartButton
@onready var help_button: Button = $PauseMenu/Panel/VBox/HelpButton

var prompt_color := Color(0.85, 0.85, 0.85)
var user_color := Color(0.45, 0.90, 0.65)

var _glow_base := Color(0.2, 1.0, 0.6, 0.10)
var _glow_pulse_alpha := 0.14

func _ready() -> void:
	input.text_submitted.connect(_on_submit)
	CommandRouter.output.connect(_on_output)
	resume_button.pressed.connect(_on_resume_pressed)
	restart_button.pressed.connect(_on_restart_pressed)
	help_button.pressed.connect(_on_help_pressed)
	input.grab_focus()
	_write_prompt("=== STARTUP WORLD ===")
	_write_prompt("Build your AI startup from garage to IPO.")
	_write_prompt("")
	_write_prompt("What's your name, founder?")
	_sync_pause_ui(true)

func _process(_delta: float) -> void:
	_sync_pause_ui(false)
	_update_glow()

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

func _write_prompt(text: String) -> void:
	log.push_color(prompt_color)
	log.add_text(text)
	log.add_text("\n")
	log.pop()

func _write_user(text: String) -> void:
	log.push_color(user_color)
	log.add_text(text)
	log.add_text("\n")
	log.pop()

func _scroll_to_bottom() -> void:
	log.scroll_to_line(max(0, log.get_line_count() - 1))

func _sync_pause_ui(force: bool) -> void:
	var should_show := GameState.paused
	if force or pause_menu.visible != should_show:
		pause_menu.visible = should_show
		# Keep the user's terminal usable/visible at all times.
		# The pause menu is a separate interaction layer.
		if not input.has_focus():
			input.grab_focus()

func _update_glow() -> void:
	var t := float(Time.get_ticks_msec()) / 1000.0
	var pulse := 0.5 + 0.5 * sin(t * 3.0)
	var alpha := _glow_base.a + _glow_pulse_alpha * pulse
	if GameState.paused:
		alpha *= 0.35
	input_glow.color = Color(_glow_base.r, _glow_base.g, _glow_base.b, alpha)

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
