# GBA の通信テスト。scripts/build-games.sh から OUT= を付けて呼ばれる（docs/builtin-games.md）
# 要るもの: games/gba-bench と同じ（Homebrew の llvm と lld、python3）。字・配置・ヘッダの検査の値は gba-bench のものを使う
LLVM_HOME ?= $(shell brew --prefix llvm 2>/dev/null || echo /opt/homebrew/opt/llvm)
LLD_HOME ?= $(shell brew --prefix lld 2>/dev/null || echo /opt/homebrew/opt/lld)
CC := $(LLVM_HOME)/bin/clang
LD := $(LLD_HOME)/bin/ld.lld
OBJCOPY := $(LLVM_HOME)/bin/llvm-objcopy
PYTHON ?= python3
OUT ?= build/linktest-gba.gba
BENCH := ../gba-bench

CFLAGS := --target=arm-none-eabi -mcpu=arm7tdmi -mthumb -O2 -ffreestanding -fno-builtin -nostdlib \
	-fno-exceptions -fno-unwind-tables -fno-asynchronous-unwind-tables -Wall -Wextra -Werror -I$(BENCH)/src
ASFLAGS := --target=arm-none-eabi -mcpu=arm7tdmi -marm

.PHONY: all clean
all: $(OUT)

build/obj/crt0.o: src/crt0.s
	@mkdir -p $(dir $@)
	$(CC) $(ASFLAGS) -c $< -o $@

build/obj/main.o: src/main.c $(BENCH)/src/font.h
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

build/linktest-gba.elf: build/obj/crt0.o build/obj/main.o $(BENCH)/gba.ld
	$(LD) -T $(BENCH)/gba.ld --no-undefined -o $@ build/obj/crt0.o build/obj/main.o

$(OUT): build/linktest-gba.elf $(BENCH)/tools/fixheader.py
	@mkdir -p $(dir $@)
	$(OBJCOPY) -O binary $< $@
	$(PYTHON) -I $(BENCH)/tools/fixheader.py $@

clean:
	rm -rf build
