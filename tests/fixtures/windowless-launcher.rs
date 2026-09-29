//! GUI-subsystem parent for the Windows guardian console regression.
#![cfg_attr(windows, windows_subsystem = "windows")]

#[path = "../../src-tauri/src/windowless_process.rs"]
mod windowless_process;

use std::process::{Command, Stdio};

fn main() {
    let result_file = std::env::args().nth(1).expect("result path");
    let mut command = Command::new("node");
    command
        .args([
            "-e",
            "const k=require('koffi'); const f=k.load('kernel32.dll').func('void* GetConsoleWindow()'); process.stdout.write(f()===null?'none':'attached');",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    windowless_process::configure_background_command(&mut command);
    let output = command.output().expect("run guardian console probe");
    assert!(output.status.success(), "guardian console probe failed: {output:?}");
    std::fs::write(result_file, output.stdout).expect("write guardian console result");
}
