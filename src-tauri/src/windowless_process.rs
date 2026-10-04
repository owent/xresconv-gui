use std::process::Command;

///A GUI-subsystem parent otherwise causes Windows to allocate a new console
///for its console-subsystem Node child. Keep stdin/stdout pipes unchanged.
#[cfg(windows)]
pub fn configure_background_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    // WinBase.h CREATE_NO_WINDOW. Unlike SW_HIDE this prevents allocating a
    // console at all; it is only applied to the guardian console executable.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn configure_background_command(_command: &mut Command) {}
