# minor version bump
npm run build

# create the current_release directory if it does not exist
mkdir -p link-colorer

# make a copy of the main.js, manifest.json, and styles.css files in another folder
cp main.js link-colorer
cp manifest.json link-colorer
cp styles.css link-colorer
# compress the current_release folder into a zip file
# zip -r release.zip current_release

# send to my novel folder
cp -r link-colorer /Users/caffae/Notes/Novel-Writing/.obsidian/plugins/
echo "Updated plugin in novel writing folder"

