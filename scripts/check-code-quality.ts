#!/usr/bin/env tsx
/**
 * Code Quality Check Script
 *
 * Run before deployments to ensure code quality standards
 * Usage: npm run quality:check
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { glob } from 'glob';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

interface Issue {
  type: 'error' | 'warning' | 'info';
  category: string;
  file: string;
  line?: number;
  message: string;
}

class CodeQualityChecker {
  private issues: Issue[] = [];
  private readonly srcDir = path.join(process.cwd(), 'src');

  async run(): Promise<boolean> {
    console.log(`${colors.bright}${colors.blue}🔍 Code Quality Check${colors.reset}\n`);

    // Run all checks
    await this.checkTypeScript();
    await this.checkTypeAssertions();
    await this.checkJSONSchemas();
    await this.checkCodeSmells();
    await this.checkConsoleStatements();
    await this.checkTodoComments();
    await this.checkUnusedExports();
    await this.checkComplexity();

    // Report results
    this.reportResults();

    // Return success/failure
    const errors = this.issues.filter(i => i.type === 'error');
    return errors.length === 0;
  }

  /**
   * 1. Check TypeScript compilation
   */
  private async checkTypeScript(): Promise<void> {
    console.log(`${colors.cyan}Checking TypeScript compilation...${colors.reset}`);

    try {
      execSync('npx tsc --noEmit', { stdio: 'pipe' });
      console.log(`${colors.green}✓${colors.reset} TypeScript compilation successful\n`);
    } catch (error: any) {
      const output = error.stdout?.toString() || error.stderr?.toString() || '';
      const lines = output.split('\n').filter(Boolean);

      lines.forEach(line => {
        const match = line.match(/(.+)\((\d+),\d+\): error TS\d+: (.+)/);
        if (match) {
          this.issues.push({
            type: 'error',
            category: 'TypeScript',
            file: match[1],
            line: parseInt(match[2]),
            message: match[3]
          });
        }
      });

      console.log(`${colors.red}✗${colors.reset} TypeScript compilation failed\n`);
    }
  }

  /**
   * 2. Check for type assertions and dangerous casts
   */
  private async checkTypeAssertions(): Promise<void> {
    console.log(`${colors.cyan}Checking for type assertions...${colors.reset}`);

    const files = await glob('**/*.{ts,tsx}', {
      cwd: this.srcDir,
      ignore: ['**/*.test.ts', '**/*.spec.ts', '__tests__/**']
    });

    const patterns = [
      { regex: /\bas\s+any\b/g, message: 'Usage of "as any" - removes all type safety' },
      { regex: /\bas\s+unknown\b/g, message: 'Usage of "as unknown" - consider proper typing' },
      { regex: /<any>/g, message: 'Usage of "<any>" type assertion' },
      { regex: /:\s*any\b/g, message: 'Usage of "any" type annotation' },
      { regex: /\bas\s+\w+\s+as\s+/g, message: 'Double type assertion - likely hiding type errors' },
      { regex: /@ts-ignore/g, message: '@ts-ignore comment - suppressing TypeScript errors' },
      { regex: /@ts-nocheck/g, message: '@ts-nocheck - disabling TypeScript for entire file' },
    ];

    let totalAssertions = 0;

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.srcDir, file), 'utf-8');
      const lines = content.split('\n');

      patterns.forEach(({ regex, message }) => {
        lines.forEach((line, index) => {
          const matches = line.matchAll(regex);
          for (const match of matches) {
            totalAssertions++;
            this.issues.push({
              type: match.source?.includes('any') ? 'error' : 'warning',
              category: 'Type Safety',
              file,
              line: index + 1,
              message
            });
          }
        });
      });
    }

    if (totalAssertions === 0) {
      console.log(`${colors.green}✓${colors.reset} No dangerous type assertions found\n`);
    } else {
      console.log(`${colors.yellow}⚠${colors.reset} Found ${totalAssertions} type assertions\n`);
    }
  }

  /**
   * 3. Validate JSON files against schemas
   */
  private async checkJSONSchemas(): Promise<void> {
    console.log(`${colors.cyan}Checking JSON schema validation...${colors.reset}`);

    const configFiles = await glob('**/*.config.json', { cwd: this.srcDir });
    let validationErrors = 0;

    for (const configFile of configFiles) {
      const configPath = path.join(this.srcDir, configFile);
      const schemaFile = configFile.replace('.json', '.schema.json');
      const schemaPath = path.join(this.srcDir, schemaFile);

      if (fs.existsSync(schemaPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

          // Basic validation (would need ajv for full validation)
          if (schema.required) {
            for (const required of schema.required) {
              if (!(required in config)) {
                validationErrors++;
                this.issues.push({
                  type: 'error',
                  category: 'JSON Schema',
                  file: configFile,
                  message: `Missing required field: ${required}`
                });
              }
            }
          }
        } catch (error: any) {
          validationErrors++;
          this.issues.push({
            type: 'error',
            category: 'JSON',
            file: configFile,
            message: `Invalid JSON: ${error.message}`
          });
        }
      } else {
        this.issues.push({
          type: 'info',
          category: 'JSON Schema',
          file: configFile,
          message: 'No schema file found'
        });
      }
    }

    if (validationErrors === 0) {
      console.log(`${colors.green}✓${colors.reset} JSON files valid\n`);
    } else {
      console.log(`${colors.red}✗${colors.reset} Found ${validationErrors} JSON validation errors\n`);
    }
  }

  /**
   * 4. Check for code smells
   */
  private async checkCodeSmells(): Promise<void> {
    console.log(`${colors.cyan}Checking for code smells...${colors.reset}`);

    const files = await glob('**/*.{ts,tsx}', {
      cwd: this.srcDir,
      ignore: ['**/*.test.ts', '**/*.spec.ts', '__tests__/**']
    });

    const smells = [
      { regex: /console\.(log|debug|info|warn|error)/g, message: 'Console statement in production code' },
      { regex: /debugger;/g, message: 'Debugger statement' },
      { regex: /\.only\(/g, message: 'Test .only() - focusing single test' },
      { regex: /\.skip\(/g, message: 'Test .skip() - skipping tests' },
      { regex: /localhost:\d+/g, message: 'Hardcoded localhost URL' },
      { regex: /FIXME/g, message: 'FIXME comment' },
      { regex: /HACK/g, message: 'HACK comment' },
      { regex: /XXX/g, message: 'XXX comment (usually indicates problem)' },
    ];

    let smellCount = 0;

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.srcDir, file), 'utf-8');
      const lines = content.split('\n');

      smells.forEach(({ regex, message }) => {
        lines.forEach((line, index) => {
          if (regex.test(line)) {
            smellCount++;
            this.issues.push({
              type: 'warning',
              category: 'Code Smell',
              file,
              line: index + 1,
              message
            });
          }
        });
      });
    }

    if (smellCount === 0) {
      console.log(`${colors.green}✓${colors.reset} No code smells detected\n`);
    } else {
      console.log(`${colors.yellow}⚠${colors.reset} Found ${smellCount} code smells\n`);
    }
  }

  /**
   * 5. Check for console statements
   */
  private async checkConsoleStatements(): Promise<void> {
    console.log(`${colors.cyan}Checking for console statements...${colors.reset}`);

    const files = await glob('**/*.{ts,tsx}', {
      cwd: this.srcDir,
      ignore: ['**/*.test.ts', '**/*.spec.ts', '__tests__/**', 'config/loader.ts']
    });

    let consoleCount = 0;

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.srcDir, file), 'utf-8');
      const matches = content.match(/console\.\w+\(/g);

      if (matches) {
        consoleCount += matches.length;
        this.issues.push({
          type: 'warning',
          category: 'Console',
          file,
          message: `Found ${matches.length} console statement(s)`
        });
      }
    }

    if (consoleCount === 0) {
      console.log(`${colors.green}✓${colors.reset} No console statements\n`);
    } else {
      console.log(`${colors.yellow}⚠${colors.reset} Found ${consoleCount} console statements\n`);
    }
  }

  /**
   * 6. Check for TODO comments
   */
  private async checkTodoComments(): Promise<void> {
    console.log(`${colors.cyan}Checking for TODO comments...${colors.reset}`);

    const files = await glob('**/*.{ts,tsx,js,jsx}', { cwd: this.srcDir });
    let todoCount = 0;

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.srcDir, file), 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        if (/\bTODO\b/i.test(line)) {
          todoCount++;
          const todoText = line.trim().replace(/.*TODO:?\s*/i, '');
          this.issues.push({
            type: 'info',
            category: 'TODO',
            file,
            line: index + 1,
            message: todoText || 'TODO comment'
          });
        }
      });
    }

    if (todoCount === 0) {
      console.log(`${colors.green}✓${colors.reset} No TODO comments\n`);
    } else {
      console.log(`${colors.cyan}ℹ${colors.reset} Found ${todoCount} TODO comments\n`);
    }
  }

  /**
   * 7. Check for unused exports (simple check)
   */
  private async checkUnusedExports(): Promise<void> {
    console.log(`${colors.cyan}Checking for unused exports...${colors.reset}`);

    try {
      // This would need ts-prune or similar tool for accurate results
      // For now, just checking if export files exist
      const indexFiles = await glob('**/index.ts', { cwd: this.srcDir });

      for (const file of indexFiles) {
        const content = fs.readFileSync(path.join(this.srcDir, file), 'utf-8');
        const exportCount = (content.match(/export/g) || []).length;

        if (exportCount > 10) {
          this.issues.push({
            type: 'info',
            category: 'Exports',
            file,
            message: `Large number of exports (${exportCount}) - consider splitting`
          });
        }
      }

      console.log(`${colors.green}✓${colors.reset} Export check complete\n`);
    } catch (error) {
      console.log(`${colors.yellow}⚠${colors.reset} Could not check exports\n`);
    }
  }

  /**
   * 8. Check cyclomatic complexity
   */
  private async checkComplexity(): Promise<void> {
    console.log(`${colors.cyan}Checking code complexity...${colors.reset}`);

    const files = await glob('**/*.{ts,tsx}', {
      cwd: this.srcDir,
      ignore: ['**/*.test.ts', '**/*.spec.ts', '__tests__/**']
    });

    let complexFunctions = 0;

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.srcDir, file), 'utf-8');

      // Simple complexity check - count decision points
      const functionMatches = content.match(/function\s+\w+|=>\s*{|method\s+\w+/g) || [];

      functionMatches.forEach(() => {
        const decisionPoints = (content.match(/if\s*\(|for\s*\(|while\s*\(|case\s+|catch\s*\(/g) || []).length;

        if (decisionPoints > 10) {
          complexFunctions++;
          this.issues.push({
            type: 'warning',
            category: 'Complexity',
            file,
            message: `High complexity detected (${decisionPoints} decision points)`
          });
        }
      });
    }

    if (complexFunctions === 0) {
      console.log(`${colors.green}✓${colors.reset} No overly complex functions\n`);
    } else {
      console.log(`${colors.yellow}⚠${colors.reset} Found ${complexFunctions} complex functions\n`);
    }
  }

  /**
   * Report all issues found
   */
  private reportResults(): void {
    console.log(`${colors.bright}${colors.blue}═══ Quality Check Results ═══${colors.reset}\n`);

    const errors = this.issues.filter(i => i.type === 'error');
    const warnings = this.issues.filter(i => i.type === 'warning');
    const info = this.issues.filter(i => i.type === 'info');

    // Group by category
    const byCategory = this.issues.reduce((acc, issue) => {
      if (!acc[issue.category]) acc[issue.category] = [];
      acc[issue.category].push(issue);
      return acc;
    }, {} as Record<string, Issue[]>);

    // Report by category
    Object.entries(byCategory).forEach(([category, issues]) => {
      console.log(`${colors.bright}${category}:${colors.reset}`);

      issues.slice(0, 10).forEach(issue => {
        const icon = issue.type === 'error' ? '✗' : issue.type === 'warning' ? '⚠' : 'ℹ';
        const color = issue.type === 'error' ? colors.red : issue.type === 'warning' ? colors.yellow : colors.cyan;
        const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;

        console.log(`  ${color}${icon}${colors.reset} ${location}`);
        console.log(`    ${issue.message}`);
      });

      if (issues.length > 10) {
        console.log(`  ... and ${issues.length - 10} more\n`);
      } else {
        console.log();
      }
    });

    // Summary
    console.log(`${colors.bright}Summary:${colors.reset}`);
    console.log(`  ${colors.red}Errors:   ${errors.length}${colors.reset}`);
    console.log(`  ${colors.yellow}Warnings: ${warnings.length}${colors.reset}`);
    console.log(`  ${colors.cyan}Info:     ${info.length}${colors.reset}`);

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`\n${colors.green}${colors.bright}✓ Code quality check passed!${colors.reset}`);
    } else if (errors.length === 0) {
      console.log(`\n${colors.yellow}${colors.bright}⚠ Code quality check passed with warnings${colors.reset}`);
    } else {
      console.log(`\n${colors.red}${colors.bright}✗ Code quality check failed${colors.reset}`);
    }
  }
}

// Run the checker
async function main() {
  const checker = new CodeQualityChecker();
  const success = await checker.run();
  process.exit(success ? 0 : 1);
}

main().catch(error => {
  console.error(`${colors.red}Error running quality check:${colors.reset}`, error);
  process.exit(1);
});