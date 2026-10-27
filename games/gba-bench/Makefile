# GBA ベンチ（GBA の重さを測るデモ）。scripts/build-games.sh から OUT= を付けて呼ばれる（docs/builtin-games.md）
# 要るもの: LLVM の clang・ld.lld・llvm-objcopy（Homebrew の llvm と lld。版は README.md）と python3（標準のものだけ）
LLVM_HOME ?= $(shell brew --prefix llvm 2>/dev/null || echo /opt/homebrew/opt/llvm)
LLD_HOME ?= $(shell brew --prefix lld 2>/dev/null || echo /opt/homebrew/opt/lld)
CC := $(LLVM_HOME)/bin/clang
LD := $(LLD_HOME)/bin/ld.lld
OBJCOPY := $(LLVM_HOME)/bin/llvm-objcopy
PYTHON ?= python3
OUT ?= build/gba-bench.gba

# ARM7TDMI。C は Thumb（ROM の 16 ビットのバスで速い）、起動のコードと割り込みは ARM
CFLAGS := --target=arm-none-eabi -mcpu=arm7tdmi -mthumb -O2 -ffreestanding -fno-builtin -nostdlib \
	-fno-exceptions -fno-unwind-tables -fno-asynchronous-unwind-tables -Wall -Wextra -Werror
ASFLAGS := --target=arm-none-eabi -mcpu=arm7tdmi -marm

.PHONY: all clean
all: $(OUT)

build/obj/crt0.o: src/crt0.s
	@mkdir -p $(dir $@)
	$(CC) $(ASFLAGS) -c $< -o $@

build/obj/main.o: src/main.c src/font.h src/sin.h
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

build/gba-bench.elf: build/obj/crt0.o build/obj/main.o gba.ld
	$(LD) -T gba.ld --no-undefined -o $@ build/obj/crt0.o build/obj/main.o

$(OUT): build/gba-bench.elf tools/fixheader.py
	@mkdir -p $(dir $@)
	$(OBJCOPY) -O binary $< $@
	$(PYTHON) -I tools/fixheader.py $@

clean:
	rm -rf build
