# ============================================================
#  Victim2Victor — single-file build (unframe method)
#
#  The composer (make/tpl.mk) streams ui/layout.html and
#  inlines the CSS, JS and every section partial into one
#  static ui/dist/index.html — no bundler, no npm, just make
#  + awk. That single file is what GitHub Pages serves.
# ============================================================

BUILD_DIR := ui/dist
SRC       := ui/layout.html
MAP       := make/web.map
COMPS     := $(wildcard ui/comps/*.html)
IMGS      := $(wildcard ui/img/*)

# the compose macro (vendored from unframe-kit; no submodule needed)
include make/tpl.mk

.PHONY: all dev stg prd clean

all: dev

# ------------------------------------------------------------
#  dev / stg / prd differ only in the back-end (Supabase) calls.
#  The JS source fences those with //online markers:
#    //online-start … //online-end   a block of back-end code
#    … code …  //online              a single back-end line
#  dev strips both (offline: mailto fallback only); stg and prd
#  keep them (online: forms insert into Supabase). See README.
# ------------------------------------------------------------

## dev — offline single-file build (back-end calls stripped)
dev:
	@mkdir -p $(BUILD_DIR)/img
	$(call compose,$(SRC),$(MAP),$(BUILD_DIR)/index.html)
	@cp $(IMGS) $(BUILD_DIR)/img/
	@sed -i -e '/\/\/online-start/,/\/\/online-end/d' -e '/\/\/online$$/d' $(BUILD_DIR)/index.html
	@echo "dev: offline build (Supabase calls stripped) → $(BUILD_DIR)/index.html"

## stg / prd — online build (Supabase calls kept)
stg prd:
	@mkdir -p $(BUILD_DIR)/img
	$(call compose,$(SRC),$(MAP),$(BUILD_DIR)/index.html)
	@cp $(IMGS) $(BUILD_DIR)/img/
	@echo "$@: online build (Supabase calls kept) → $(BUILD_DIR)/index.html"

## clean — remove the generated output
clean:
	@rm -rf $(BUILD_DIR)
