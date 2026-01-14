# minor version bump
npm version patch --no-git-tag-version

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

zip -vr link-colorer.zip link-colorer -x "*.DS_Store"

mv link-colorer.zip release.zip

# remove the current_release folder
# rm -rf link-colorer

# Get the new version and create a tag without 'v' prefix
VERSION=$(node -p "require('./package.json').version")
git add -A
LASTCOMMIT=$(git log -1 --pretty=%B)
# git commit -m "Prepare for Git Release. Bump version to $VERSION"
git commit -m "Release version $VERSION, $LASTCOMMIT"
git tag $VERSION
# git push origin main
echo "Pushing to main tag... "
# echo "git push origin tag $VERSION"
git push origin tag $VERSION
echo "Creating a new release... "
# Create a new release on GitHub with the zip file and the last commit message
gh release create $VERSION release.zip main.js styles.css manifest.json --title "Release $VERSION" --notes "$LASTCOMMIT"

