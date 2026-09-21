"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UI = void 0;
const chalk_1 = __importDefault(require("chalk"));
const logger_1 = require("./logger");
// Claude Code Inspired Palette
const Palette = {
    Brand: '#D97757', // Warm Terracotta (Main Brand)
    Error: '#D95858', // Soft Red
    Warning: '#D9A458', // Mustard Yellow
    Dim: '#6B6B6B', // Dark Gray
    Text: '#E6E6E6', // Off-White
    Border: '#3F3F3F', // Subtle Border
    Highlight: '#A78BFA', // Soft Purple (Files/Links)
};
class UI {
    static log(message) {
        logger_1.logger.print(message);
    }
    static info(message) {
        this.log(`${chalk_1.default.hex(Palette.Dim).bold('•')} ${chalk_1.default.hex(Palette.Text)(message)}`);
    }
    static success(message) {
        this.log(`${chalk_1.default.hex(Palette.Brand)('✔')} ${chalk_1.default.hex(Palette.Brand)(message)}`);
    }
    static warning(message) {
        this.log(`${chalk_1.default.hex(Palette.Dim)('⚠')} ${message}`);
    }
    static error(message, error) {
        this.log(`${chalk_1.default.hex(Palette.Dim)('✖')} ${message}`);
        if (error && error.message) {
            this.log(chalk_1.default.hex(Palette.Error)(`  ${error.message}`));
        }
    }
    static header(subtitle) {
        this.log('');
        this.log(chalk_1.default.hex(Palette.Dim)(`  ${subtitle}`));
        this.log('');
    }
    static status(text) {
        this.log(`${chalk_1.default.hex(Palette.Dim)('•')} ${chalk_1.default.hex(Palette.Text)(text)}`);
    }
    static statusDone(success = true, text) {
        if (success) {
            this.log(`${chalk_1.default.hex(Palette.Dim)('✔')} ${text || ''}`);
        }
        else {
            this.log(`${chalk_1.default.hex(Palette.Dim)('✖')} ${text || ''}`);
        }
    }
    static box(title, content) {
        const border = chalk_1.default.hex(Palette.Border)('──────────────────────────────────────────────────');
        this.log('');
        this.log(border);
        this.log(chalk_1.default.hex(Palette.Brand).bold(`  ${title}`));
        this.log(border);
        content.forEach((line) => this.log(`  ${line}`));
        this.log(border);
        this.log('');
    }
    static newUrl(url) {
        return chalk_1.default.hex(Palette.Highlight).bold.underline(url);
    }
    static dim(text) {
        return chalk_1.default.hex(Palette.Dim)(text);
    }
    static highlight(text) {
        return chalk_1.default.hex(Palette.Highlight)(text);
    }
    static hint(text) {
        this.log(`  ${chalk_1.default.hex(Palette.Dim)(text)}`);
    }
    static banner() {
        const brand = chalk_1.default.hex(Palette.Brand);
        const dim = chalk_1.default.hex(Palette.Dim);
        // USB adapter with CLAUDE text inside
        const art = [
            '',
            dim('     ┌────────────────────┐'),
            dim('     │ ') + brand('┌─┐┬  ┌─┐┬ ┬┌┬┐┌─┐') + dim(' ├──┐'),
            dim('     │ ') + brand('│  │  ├─┤│ │ ││├┤ ') + dim(' │▓▓│'),
            dim('     │ ') + brand('└─┘┴─┘┴ ┴└─┘─┴┘└─┘') + dim(' ├──┘'),
            dim('     └──────•ADAPTER──────┘'),
            '',
        ];
        art.forEach((line) => this.log(line));
    }
    static table(rows) {
        const maxLabelWidth = Math.max(...rows.map((r) => r.label.length));
        this.log('');
        rows.forEach((row) => {
            const paddedLabel = row.label.padEnd(maxLabelWidth);
            this.log(`  ${chalk_1.default.hex(Palette.Dim)(paddedLabel)}  ${chalk_1.default.hex(Palette.Highlight)(row.value)}`);
        });
        this.log('');
    }
    static updateNotify(current, latest) {
        this.log('');
        this.log(`${chalk_1.default.hex(Palette.Dim)('•')} ${chalk_1.default.hex(Palette.Text)('Update available:')} ${chalk_1.default.hex(Palette.Dim)(current)} ${chalk_1.default.hex(Palette.Dim)('→')} ${chalk_1.default.hex(Palette.Highlight)(latest)}`);
        this.hint('Run "npm i -g claude-adapter" to update');
    }
}
exports.UI = UI;
//# sourceMappingURL=ui.js.map