import os
import json

# CONFIG
ROOT_DIR = "./"  # change if needed
OUTPUT_FILE = "output.txt"
EXCLUDE_DIRS = {"node_modules", ".expo", ".git", "__pycache__"}
CODE_EXTENSIONS = {".js", ".ts", ".tsx", ".json", ".jsx"}

def extract_versions(file_path):
    versions = []
    try:
        if file_path.endswith("package.json"):
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

                for section in ["dependencies", "devDependencies"]:
                    if section in data:
                        for lib, version in data[section].items():
                            versions.append(f"{lib}: {version}")
    except Exception as e:
        versions.append(f"Error reading {file_path}: {e}")
    
    return versions


def main():
    all_versions = []

    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        for root, dirs, files in os.walk(ROOT_DIR):
            # Exclude folders
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

            for file in files:
                file_path = os.path.join(root, file)

                # Extract versions
                if file == "package.json":
                    versions = extract_versions(file_path)
                    if versions:
                        out.write("\n=== TECH STACK VERSIONS ===\n")
                        for v in versions:
                            out.write(v + "\n")
                        all_versions.extend(versions)

                # Extract code
                if any(file.endswith(ext) for ext in CODE_EXTENSIONS):
                    try:
                        with open(file_path, "r", encoding="utf-8") as f:
                            content = f.read()

                        out.write(f"\n\n===== FILE: {file_path} =====\n")
                        out.write(content)

                    except Exception as e:
                        out.write(f"\nError reading {file_path}: {e}\n")

    print("✅ Extraction complete → output.txt")


if __name__ == "__main__":
    main()