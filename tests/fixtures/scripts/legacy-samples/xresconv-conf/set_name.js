if (item_data.file) {
    item_data.name += " (" + item_data.file.match(/([^.]+)\.\w+$/)[1] + ")"
}
