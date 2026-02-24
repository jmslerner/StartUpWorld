extends Control

@onready var log: RichTextLabel = $Log
@onready var input: LineEdit = $Input
@onready var pause_menu: Control = $PauseMenu
@onready var resume_button: Button = $PauseMenu/Panel/VBox/ResumeButton
@onready var restart_button: Button = $PauseMenu/Panel/VBox/RestartButton
@onready var help_button: Button = $PauseMenu/Panel/VBox/HelpButton

var prompt_color := Color(0.85, 0.85, 0.85)
var user_color := Color(0.45, 0.90, 0.65)

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
		input.editable = not should_show
		if should_show:
			resume_button.grab_focus()
		else:
			input.grab_focus()

func _on_resume_pressed() -> void:
	CommandRouter.run("resume")
	_scroll_to_bottom()

func _on_restart_pressed() -> void:
	CommandRouter.run("restart")
	_scroll_to_bottom()

func _on_help_pressed() -> void:
	CommandRouter.run("help")
	_scroll_to_bottom()
