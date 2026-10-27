/* GBA の配置: コードと定数は ROM（0x08000000）、書き換える値は IWRAM（0x03000000） */
ENTRY(_start)

MEMORY {
    rom   (rx)  : ORIGIN = 0x08000000, LENGTH = 32M
    iwram (rwx) : ORIGIN = 0x03000000, LENGTH = 31K
}

SECTIONS {
    .text : {
        KEEP(*(.header))
        *(.text .text.*)
        *(.rodata .rodata.*)
        . = ALIGN(4);
    } > rom

    .data : {
        __data_start = .;
        *(.data .data.*)
        . = ALIGN(4);
        __data_end = .;
    } > iwram AT > rom
    __data_load = LOADADDR(.data);

    .bss (NOLOAD) : {
        __bss_start = .;
        *(.bss .bss.* COMMON)
        . = ALIGN(4);
        __bss_end = .;
    } > iwram

    /DISCARD/ : { *(.ARM.exidx*) *(.ARM.attributes) *(.comment) }
}
