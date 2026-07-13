// Assembles a self-contained installer folder for the Branch Bridge agent:
//   packaging/dist-pkg/aire-branch-bridge/
//     dist/  node_modules/ (prod)  package.json  package-lock.json
//     install.ps1  uninstall.ps1  service-run.ps1     (Windows)
//     install.sh   aire-branch-bridge.service          (Linux)
// Run: npm run package   (from apps/branch-bridge). Then zip the folder and hand
// it to the branch operator, who runs install.ps1 (Win) or install.sh (Linux).
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const outRoot = join(here, 'dist-pkg');
const stage = join(outRoot, 'aire-branch-bridge');

const run = (cmd, cwd) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

console.log('== building agent ==');
run('npm run build', appRoot);

console.log('== staging ==');
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// App payload.
cpSync(join(appRoot, 'dist'), join(stage, 'dist'), { recursive: true });
cpSync(join(appRoot, 'package.json'), join(stage, 'package.json'));
if (existsSync(join(appRoot, 'package-lock.json'))) {
  cpSync(join(appRoot, 'package-lock.json'), join(stage, 'package-lock.json'));
}

// Production node_modules — install fresh into the stage so it ships complete
// (the branch may have no network / a different npm).
console.log('== installing production deps into package ==');
run('npm ci --omit=dev --no-audit --no-fund', stage);

// Installer scripts at the package root (both installers expect siblings).
for (const f of ['windows/install.ps1', 'windows/uninstall.ps1', 'windows/service-run.ps1']) {
  cpSync(join(here, f), join(stage, f.split('/').pop()));
}
for (const f of ['linux/install.sh', 'linux/aire-branch-bridge.service']) {
  cpSync(join(here, f), join(stage, f.split('/').pop()));
}
if (existsSync(join(here, 'README.md'))) {
  cpSync(join(here, 'README.md'), join(stage, 'README.md'));
}

console.log('== package contents ==');
for (const e of readdirSync(stage)) console.log('  ' + e);

// Best-effort zip (non-fatal if the archiver is absent).
try {
  const zip = join(outRoot, 'aire-branch-bridge.zip');
  if (process.platform === 'win32') {
    run(
      `powershell -NoProfile -Command "Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -Force"`,
      outRoot,
    );
  } else {
    run(`tar -a -c -f "${zip}" -C "${outRoot}" aire-branch-bridge`, outRoot);
  }
  console.log(`\nDONE -> ${zip}`);
} catch {
  console.log(`\nDONE -> folder ${stage} (zip it manually to distribute)`);
}
