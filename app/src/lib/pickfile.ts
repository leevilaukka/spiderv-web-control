// Asks for a file without a file input on the page, so menus that close on
// click can still offer one.
export function pickFile(accept: string, picked: (file: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) picked(file);
  };
  input.click();
}

export const TONE_FILES = '.svl6p,.slv6p,.l6t,.json,.bin,application/json';
export const SETTINGS_FILES = '.json,application/json';
