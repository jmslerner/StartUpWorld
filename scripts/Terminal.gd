extends Control

@onready var log: RichTextLabel = $Log
@onready var input: LineEdit = $Input

func _ready() -> void:
	input.text_submitted.connect(_on_submit)
	CommandRouter.output.connect(_on_output)
	input.grab_focus()
	_on_output("Type 'help' to see commands.")

func _on_submit(text: String) -> void:
	var trimmed := text.strip_edges()
	if trimmed.is_empty():
		return
	log.append_text("> " + trimmed + "\n")
	input.clear()
	CommandRouter.run(trimmed)
	_scroll_to_bottom()

func _on_output(text: String) -> void:
	log.append_text(text + "\n")
	_scroll_to_bottom()

func _scroll_to_bottom() -> void:
	log.scroll_to_line(max(0, log.get_line_count() - 1))
