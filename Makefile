# ============================================================
#  Victim2Victor — single-file build (unframe method)
#
#  The composer (make/../unframe-kit/runtime/tpl.mk) streams
#  ui/layout.html and inlines the CSS, JS and every section
#  partial into one static ui/dist/index.html — no bundler,
#  no npm, just make + awk. That single file is what GitHub
#  Pages serves.
# ============================================================

BUILD_DIR := ui/dist
SRC       := ui/layout.html
MAP       := make/web.map
COMPS     := $(wildcard ui/comps/*.html)
IMGS      := $(wildcard ui/img/*)

# the compose macro lives in the unframe-kit submodule (single source of truth)
include unframe-kit/runtime/tpl.mk

.PHONY: all dev clean

all: dev

## dev — build the static single-file site into ui/dist/
dev: $(BUILD_DIR)/index.html

$(BUILD_DIR)/index.html: $(SRC) ui/layout.css ui/layout.js $(COMPS) $(MAP) $(IMGS)
	@mkdir -p $(BUILD_DIR)/img
	$(call compose,$(SRC),$(MAP),$@)
	@cp $(IMGS) $(BUILD_DIR)/img/
	@echo "Built $@"

## clean — remove the generated output
clean:
	@rm -rf $(BUILD_DIR)
