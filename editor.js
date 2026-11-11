import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const rotate = document.querySelector('#rotate');
const remove = document.querySelector('#remove');
const catalogResponse = await fetch('./furniture-catalog.json', { cache: 'no-store' });
if (!catalogResponse.ok) throw new Error('Furniture catalog unavailable');
const entries = await catalogResponse.json();
const furniture = Object.fromEntries(entries.map(entry => [entry.id, entry]));
const wallpaperResponse = await fetch('./wallpaper-catalog.json', { cache: 'no-store' });
if (!wallpaperResponse.ok) throw new Error('Wallpaper catalog unavailable');
const wallpapers = await wallpaperResponse.json();
const wallpaperButton = document.querySelector('#choose-wallpaper');
const wallpaperSheet = document.querySelector('#wallpaper-sheet');
const wallpaperOptions = document.querySelector('#wallpaper-options');
const wallpaperSize = document.querySelector('#wallpaper-size');
const wallpaperSizeValue = document.querySelector('#wallpaper-size-value');
const wallpaperMessage = document.querySelector('#wallpaper-message');
const wallpaperApply = document.querySelector('#wallpaper-apply');
const wallpaperCancel = document.querySelector('#wallpaper-cancel');
const wallpaperTextures = new Map();
const textureLoader = new THREE.TextureLoader();
let wallpaperDraft = null;
let wallpaperOutline = null;
const catalogContainer = document.querySelector('.catalog');
catalogContainer.replaceChildren();
for (const entry of entries) {
    const button = document.createElement('button');
    button.dataset.piece = entry.id;
    button.textContent = entry.name;
    catalogContainer.append(button);
}
const catalog = [...catalogContainer.querySelectorAll('button')];
const preview = document.querySelector('#preview');
const result = document.querySelector('#result');
const arViewer = document.querySelector('#ar-viewer');
const arScale = document.querySelector('#ar-scale');
const launchAR = document.querySelector('#launch-ar');
let arUrl = null;
let previewRoom = null;
let previewZoom = 1;
const previewPointers = new Map();
let pinchDistance = 0;
arViewer.addEventListener('load', () => {
    launchAR.disabled = !arViewer.canActivateAR;
    if (!arViewer.canActivateAR) status.textContent = '3Dプレビューを表示しています。ARを見るには、対応するスマートフォンとブラウザーが必要です。';
});
launchAR.addEventListener('click', () => {
    arViewer.activateAR().catch(error => {
        console.error(error);
        status.textContent = 'この端末ではARを起動できませんでした。';
    });
});
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e5ebf1');
let renderer;
try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (error) {
    status.textContent = 'このブラウザーではWebGLを起動できませんでした。';
    for (const button of [...catalog, preview]) button.disabled = true;
    throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.append(renderer.domElement);

const camera = new THREE.OrthographicCamera();
camera.position.set(6, 8, 10);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8d7a, 2.4));
const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(3, 8, 6);
scene.add(light);
const loader = new GLTFLoader();
const floorsResponse = await fetch('./house-floors.json', { cache: 'no-store' });
if (!floorsResponse.ok) throw new Error('House floor catalog unavailable');
const floorEntries = await floorsResponse.json();
const floors = new Map();
const previewMaterials = new Map();
const floorSelect = document.querySelector('#floor-select');
const showWalls = document.querySelector('#show-walls');
const wallColor = document.querySelector('#wall-color');
let activeFloor;
let floorWidth;
let floorDepth;
const cameraTarget = new THREE.Vector3();
for (const button of catalog) button.disabled = true;
preview.disabled = true;
floorSelect.disabled = showWalls.disabled = wallColor.disabled = wallpaperButton.disabled = true;

function addFloorGrid(material) {
    const gridMaterial = material.clone();
    gridMaterial.color.set("#c19a70");
    gridMaterial.map = null;
    gridMaterial.roughness = 0.9;
    gridMaterial.metalness = 0;
    previewMaterials.set(gridMaterial.uuid, material);
    gridMaterial.onBeforeCompile = shader => {
        shader.vertexShader = 'varying vec3 vFloorGridPosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            '#include <project_vertex>\nvFloorGridPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;'
        );
        shader.fragmentShader = 'varying vec3 vFloorGridPosition;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `vec2 gridPosition = vFloorGridPosition.xz / 0.5;
            vec2 gridDistance = abs(fract(gridPosition - 0.5) - 0.5) /
                max(fwidth(gridPosition), vec2(0.0001));
            float gridLine = 1.0 - min(min(gridDistance.x, gridDistance.y), 1.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.28, 0.32, 0.35), gridLine * 0.45);
            #include <dithering_fragment>`
        );
    };
    return gridMaterial;
}

function prepareWallpaperUVs(floor) {
    if (floor.wallpaperUVsReady) return;
    floor.architecture.updateMatrixWorld(true);
    for (const mesh of floor.wallMeshes) {
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        const positions = geometry.getAttribute('position');
        const uv = new Float32Array(positions.count * 2);
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        const normal = new THREE.Vector3(), edge = new THREE.Vector3();
        for (let index = 0; index < positions.count; index += 3) {
            a.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
            b.fromBufferAttribute(positions, index + 1).applyMatrix4(mesh.matrixWorld);
            c.fromBufferAttribute(positions, index + 2).applyMatrix4(mesh.matrixWorld);
            normal.crossVectors(edge.subVectors(b, a), c.clone().sub(a)).normalize();
            const horizontal = Math.abs(normal.y) > 0.7;
            const useZ = Math.abs(normal.x) > Math.abs(normal.z);
            for (const [offset, point] of [a, b, c].entries()) {
                uv[(index + offset) * 2] = horizontal ? point.x : useZ ? point.z : point.x;
                uv[(index + offset) * 2 + 1] = horizontal ? point.z : point.y;
            }
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        mesh.geometry = geometry;
    }
    floor.wallpaperUVsReady = true;
}

async function loadFloor(index) {
    if (floors.has(index)) return floors.get(index);
    const entry = floorEntries[index];
    const gltf = await loader.loadAsync(entry.url);
    const architecture = gltf.scene;
    const floorMeshes = [];
    const wallMeshes = [];
    const wallMaterials = new Set();
    architecture.traverse(object => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some(material => material.name === 'floor')) floorMeshes.push(object);
        if (materials.some(material => material.name === 'internalWall')) wallMeshes.push(object);
        const mapped = materials.map(material => {
            if (material.name === 'floor') return addFloorGrid(material);
            if (!['wallpaint', 'internalWall'].includes(material.name)) return material;
            const wall = material.clone();
            wall.color.set('#c9bead');
            wall.map = null;
            wall.roughness = 0.88;
            wall.metalness = 0;
            previewMaterials.set(wall.uuid, material);
            if (material.name === 'internalWall') wallMaterials.add(wall);
            return wall;
        });
        object.material = Array.isArray(object.material) ? mapped : mapped[0];
    });
    if (!floorMeshes.length) throw new Error('Missing floor material: ' + entry.name);
    architecture.updateMatrixWorld(true);
    const floorBounds = new THREE.Box3();
    for (const mesh of floorMeshes) floorBounds.union(new THREE.Box3().setFromObject(mesh));
    const floorElevation = floorBounds.max.y;
    architecture.position.y -= floorElevation;
    architecture.updateMatrixWorld(true);
    floorBounds.translate(new THREE.Vector3(0, -floorElevation, 0));
    const room = new THREE.Group();
    room.name = entry.name;
    const pieces = new THREE.Group();
    room.add(architecture, pieces);
    const loaded = {
        room, pieces, architecture, floorMeshes, floorBounds, wallMaterials, wallMeshes,
        wallpaper: { id: null, size: 100 }, wallpaperTexture: null, plainWallColor: '#c9bead'
    };
    floors.set(index, loaded);
    return loaded;
}

function updateWallVisibility() {
    const floorMeshes = new Set(activeFloor.floorMeshes);
    activeFloor.architecture.traverse(object => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const isRoof = materials.some(material => material.name === 'roof');
        object.visible = !isRoof && (showWalls.checked || floorMeshes.has(object) ||
            materials.some(material => material.name === 'internalWall'));
    });
}

function activateFloor(loaded) {
    if (activeFloor) scene.remove(activeFloor.room);
    activeFloor = loaded;
    scene.add(activeFloor.room);
    const size = activeFloor.floorBounds.getSize(new THREE.Vector3());
    floorWidth = size.x;
    floorDepth = size.z;
    activeFloor.floorBounds.getCenter(cameraTarget);
    const interiorBounds = activeFloor.floorBounds.clone();
    activeFloor.architecture.traverse(object => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some(material => material.name === 'internalWall')) {
            interiorBounds.union(new THREE.Box3().setFromObject(object));
        }
    });
    cameraTarget.y = interiorBounds.getCenter(new THREE.Vector3()).y;
    camera.position.copy(cameraTarget).add(new THREE.Vector3(6, 8, 10).normalize()
        .multiplyScalar(Math.max(floorWidth, floorDepth) * 1.6));
    camera.lookAt(cameraTarget);
    updateWallVisibility();
    const wall = [...activeFloor.wallMaterials][0];
    wallColor.disabled = !wall || Boolean(activeFloor.wallpaper.id);
    if (wall) wallColor.value = activeFloor.plainWallColor;
    wallpaperButton.disabled = !wall;
}

activateFloor(await loadFloor(Number(floorSelect.value)));
for (const button of catalog) button.disabled = false;
preview.disabled = false;
floorSelect.disabled = showWalls.disabled = false;

function refreshWallpaperOptions() {
    const id = activeFloor.wallpaper.id ?? '';
    for (const button of wallpaperOptions.querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.wallpaper === id));
    }
    wallpaperSize.value = String(activeFloor.wallpaper.size);
    wallpaperSizeValue.value = activeFloor.wallpaper.size + ' cm';
    wallpaperSize.disabled = !activeFloor.wallpaper.id;
}

for (const entry of [{ id: '', name: '単色' }, ...wallpapers]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.wallpaper = entry.id;
    button.className = 'wallpaper-option';
    if (entry.thumbnail) {
        const image = document.createElement('img');
        image.src = entry.thumbnail;
        image.alt = '';
        image.width = image.height = 72;
        button.append(image);
    } else {
        const swatch = document.createElement('span');
        swatch.className = 'wallpaper-plain';
        button.append(swatch);
    }
    const name = document.createElement('span');
    name.textContent = entry.name;
    button.append(name);
    button.addEventListener('click', () => chooseWallpaper(entry.id));
    wallpaperOptions.append(button);
}

function setWallpaperControls(open) {
    for (const control of [...catalog, floorSelect, wallColor, preview, wallpaperButton]) {
        control.disabled = open;
    }
    wallColor.disabled = open || !activeFloor.wallMaterials.size || Boolean(activeFloor.wallpaper.id);
    wallpaperButton.disabled = open || !activeFloor.wallMaterials.size;
    rotate.disabled = remove.disabled = open || !selected;
}

function clearWallpaperOutline() {
    if (!wallpaperOutline) return;
    scene.remove(wallpaperOutline);
    wallpaperOutline.traverse(line => {
        line.geometry?.dispose();
        line.material?.dispose();
    });
    wallpaperOutline = null;
}

function openWallpaper() {
    if (wallpaperDraft || !result.hidden || !activeFloor.wallMaterials.size) return;
    armed = null;
    selected = null;
    prepareWallpaperUVs(activeFloor);
    wallpaperDraft = {
        floor: activeFloor,
        savedState: { ...activeFloor.wallpaper },
        savedTexture: activeFloor.wallpaperTexture,
        materials: [...activeFloor.wallMaterials].map(material => ({
            material, map: material.map, color: material.color.clone()
        })),
        request: 0
    };
    wallpaperOutline = new THREE.Group();
    for (const mesh of activeFloor.wallMeshes) {
        const outline = new THREE.LineSegments(
            new THREE.EdgesGeometry(mesh.geometry, 45),
            new THREE.LineBasicMaterial({ color: '#2f6c9e', transparent: true, opacity: 0.65 })
        );
        outline.matrixAutoUpdate = false;
        outline.matrix.copy(mesh.matrixWorld);
        wallpaperOutline.add(outline);
    }
    scene.add(wallpaperOutline);
    document.querySelector('#wallpaper-scope').textContent = activeFloor.room.name + '・内壁すべて';
    wallpaperMessage.textContent = '壁紙をタップすると、その場で確認できます。';
    wallpaperApply.disabled = false;
    refreshWallpaperOptions();
    wallpaperSheet.hidden = false;
    setWallpaperControls(true);
    draw();
    if (window.matchMedia('(max-width: 700px)').matches) stage.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function chooseWallpaper(id) {
    const draft = wallpaperDraft;
    if (!draft) return;
    const request = ++draft.request;
    wallpaperApply.disabled = true;
    wallpaperMessage.textContent = '壁紙を読み込んでいます…';
    try {
        let texture = null;
        if (id) {
            const entry = wallpapers.find(entry => entry.id === id);
            if (!wallpaperTextures.has(id)) {
                const pending = textureLoader.loadAsync(entry.url).catch(error => {
                    wallpaperTextures.delete(id);
                    throw error;
                });
                wallpaperTextures.set(id, pending);
            }
            const original = await wallpaperTextures.get(id);
            if (wallpaperDraft !== draft || draft.request !== request) return;
            texture = original.clone();
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.flipY = false;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.setScalar(100 / draft.floor.wallpaper.size);
            texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            texture.needsUpdate = true;
        }
        const previous = draft.floor.wallpaperTexture;
        draft.floor.wallpaperTexture = texture;
        draft.floor.wallpaper.id = id || null;
        for (const material of draft.floor.wallMaterials) {
            material.map = texture;
            material.color.set(texture ? '#ffffff' : draft.floor.plainWallColor);
            material.needsUpdate = true;
        }
        if (previous && previous !== draft.savedTexture) previous.dispose();
        refreshWallpaperOptions();
        wallpaperMessage.textContent = '回転して確認できます。よければ「適用」を押してください。';
        draw();
    } catch (error) {
        console.error(error);
        if (wallpaperDraft === draft && draft.request === request) {
            wallpaperMessage.textContent = '壁紙を読み込めませんでした。もう一度選んでください。';
        }
    } finally {
        if (wallpaperDraft === draft && draft.request === request) wallpaperApply.disabled = false;
    }
}

function closeWallpaper(apply) {
    const draft = wallpaperDraft;
    if (!draft) return;
    wallpaperDraft = null;
    const current = draft.floor.wallpaperTexture;
    if (!apply) {
        for (const snapshot of draft.materials) {
            snapshot.material.map = snapshot.map;
            snapshot.material.color.copy(snapshot.color);
            snapshot.material.needsUpdate = true;
        }
        draft.floor.wallpaper = draft.savedState;
        draft.floor.wallpaperTexture = draft.savedTexture;
        draft.savedTexture?.repeat.setScalar(100 / draft.savedState.size);
        if (current && current !== draft.savedTexture) current.dispose();
    } else if (draft.savedTexture && current !== draft.savedTexture) {
        draft.savedTexture.dispose();
    }
    clearWallpaperOutline();
    wallpaperSheet.hidden = true;
    setWallpaperControls(false);
    updateControls(apply ? 'この階の内壁に壁紙を適用しました。' : '壁紙の変更を取り消しました。');
    wallpaperButton.focus({ preventScroll: true });
}

wallpaperButton.addEventListener('click', openWallpaper);
wallpaperCancel.addEventListener('click', () => closeWallpaper(false));
wallpaperApply.addEventListener('click', () => closeWallpaper(true));
wallpaperSize.addEventListener('input', () => {
    if (!wallpaperDraft) return;
    const floor = wallpaperDraft.floor;
    floor.wallpaper.size = Number(wallpaperSize.value);
    floor.wallpaperTexture?.repeat.setScalar(100 / floor.wallpaper.size);
    wallpaperSizeValue.value = floor.wallpaper.size + ' cm';
    draw();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && wallpaperDraft) closeWallpaper(false);
});

const pieceTemplates = new Map();
const pendingModels = new Map();
const centimeters = meters => Math.round(meters * 1000) / 10;

async function loadPiece(type) {
    if (pieceTemplates.has(type)) return pieceTemplates.get(type);
    if (pendingModels.has(type)) return pendingModels.get(type);
    const entry = furniture[type];
    const task = (async () => {
        if (!entry.url) throw new Error('Model has not been uploaded to S3');
        const gltf = await loader.loadAsync(entry.url);
        const model = new THREE.Group();
        model.name = entry.name;
        model.userData.type = type;
        gltf.scene.scale.setScalar(entry.scale ?? 1);
        const bounds = new THREE.Box3().setFromObject(gltf.scene);
        const size = bounds.getSize(new THREE.Vector3());
        if (![size.x, size.y, size.z].every(value => Number.isFinite(value) && value > 0)) {
            throw new Error('Invalid model dimensions');
        }
        gltf.scene.position.sub(new THREE.Vector3(
            (bounds.min.x + bounds.max.x) / 2,
            bounds.min.y,
            (bounds.min.z + bounds.max.z) / 2
        ));
        model.add(gltf.scene);
        entry.width = size.x;
        entry.depth = size.z;
        const dimensions = [size.x, size.z, size.y].map(centimeters).join(' × ');
        const template = { model, top: size.y, dimensions };
        pieceTemplates.set(type, template);
        return template;
    })();
    pendingModels.set(type, task);
    try {
        return await task;
    } finally {
        pendingModels.delete(type);
    }
}

const sizeFlag = document.querySelector('#size-flag');
const flagPosition = new THREE.Vector3();
let flaggedType = null;

const ray = new THREE.Raycaster();
const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointer = new THREE.Vector2();
let armed = null;
let selected = null;
let gesture = null;
const selection = new THREE.BoxHelper(new THREE.Object3D(), 0x245e9b);
selection.visible = false;
scene.add(selection);

function draw() {
    selection.visible = !!selected;
    if (selected) selection.setFromObject(selected);
    renderer.render(scene, camera);
    sizeFlag.hidden = !selected;
    if (!selected || !stage.clientWidth) return;

    const type = selected.userData.type;
    const { top, dimensions } = pieceTemplates.get(type);
    if (flaggedType !== type) {
        sizeFlag.textContent = furniture[type].name + ' · ' + dimensions + ' cm';
        flaggedType = type;
    }
    selected.getWorldPosition(flagPosition);
    flagPosition.y += top;
    flagPosition.project(camera);
    const x = (flagPosition.x + 1) * stage.clientWidth / 2;
    const y = (1 - flagPosition.y) * stage.clientHeight / 2;
    const halfWidth = sizeFlag.offsetWidth / 2;
    sizeFlag.style.left = THREE.MathUtils.clamp(x, halfWidth + 4, stage.clientWidth - halfWidth - 4) + 'px';
    sizeFlag.style.top = Math.max(y, sizeFlag.offsetHeight + 13) + 'px';
}
function resize() {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height) return;
    fitCamera(width / height);
    renderer.setSize(width, height, false);
    draw();
}
function fitCamera(aspect = stage.clientWidth / stage.clientHeight) {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    activeFloor.room.updateMatrixWorld(true);
    const bounds = previewRoom
        ? new THREE.Box3().setFromObject(previewRoom)
        : activeFloor.floorBounds.clone();
    if (!previewRoom) {
        activeFloor.architecture.traverse(object => {
            if (object.isMesh && object.visible) bounds.union(new THREE.Box3().setFromObject(object));
        });
        if (activeFloor.pieces.children.length) {
            bounds.union(new THREE.Box3().setFromObject(activeFloor.pieces));
        }
    }
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius + sphere.center.distanceTo(cameraTarget);
    const halfHeight = Math.max(radius, 0.5) * 1.06 / Math.min(aspect, 1);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.zoom = previewRoom ? previewZoom : 1;
    camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

function updateControls(message) {
    status.textContent = message;
    rotate.disabled = remove.disabled = !selected || !result.hidden;
    for (const button of catalog) button.setAttribute('aria-pressed', String(button.dataset.piece === armed));
    draw();
}
function pointAt(event) {
    const bounds = stage.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
    ray.setFromCamera(pointer, camera);
    return ray.ray.intersectPlane(floor, new THREE.Vector3());
}
function floorPoint(point) {
    if (!point) return null;
    const down = new THREE.Raycaster(
        new THREE.Vector3(point.x, 50, point.z), new THREE.Vector3(0, -1, 0)
    );
    const hit = down.intersectObjects(activeFloor.floorMeshes, false).find(hit =>
        hit.face && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > 0.5
    );
    return hit?.point ?? null;
}
function onFloor(point) {
    return !!floorPoint(point);
}
function position(piece, point, usePointer = false) {
    const entry = furniture[piece.userData.type];
    if (entry.placement === 'surface') {
        const supports = activeFloor.pieces.children.filter(candidate =>
            candidate !== piece && entry.supportTypes.includes(candidate.userData.type)
        );
        const supportRay = usePointer ? ray : new THREE.Raycaster(
            new THREE.Vector3(point.x, 20, point.z), new THREE.Vector3(0, -1, 0)
        );
        const hits = supportRay.intersectObjects(supports, true).filter(hit => {
            let owner = hit.object;
            while (owner && !owner.userData.type) owner = owner.parent;
            return supports.includes(owner) && hit.face &&
                hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > 0.5;
        });
        const hit = hits[0];
        if (!hit) return false;
        let support = hit.object;
        while (support && !supports.includes(support)) support = support.parent;
        support.attach(piece);
        piece.position.copy(support.worldToLocal(hit.point.clone()));
        const supportEntry = furniture[support.userData.type];
        const cosine = Math.abs(Math.cos(piece.rotation.y));
        const sine = Math.abs(Math.sin(piece.rotation.y));
        const halfWidth = (cosine * entry.width + sine * entry.depth) / 2;
        const halfDepth = (sine * entry.width + cosine * entry.depth) / 2;
        const xLimit = Math.max(0, supportEntry.width / 2 - halfWidth);
        const zLimit = Math.max(0, supportEntry.depth / 2 - halfDepth);
        piece.position.x = THREE.MathUtils.clamp(piece.position.x, -xLimit, xLimit);
        piece.position.z = THREE.MathUtils.clamp(piece.position.z, -zLimit, zLimit);
        piece.visible = true;
        return true;
    }
    const { width, depth } = furniture[piece.userData.type];
    const c = Math.abs(Math.cos(piece.rotation.y));
    const s = Math.abs(Math.sin(piece.rotation.y));
    const x = (c * width + s * depth) / 2;
    const z = (s * width + c * depth) / 2;
    const bounds = activeFloor.floorBounds;
    const minX = Math.min(bounds.min.x + x, (bounds.min.x + bounds.max.x) / 2);
    const maxX = Math.max(bounds.max.x - x, (bounds.min.x + bounds.max.x) / 2);
    const minZ = Math.min(bounds.min.z + z, (bounds.min.z + bounds.max.z) / 2);
    const maxZ = Math.max(bounds.max.z - z, (bounds.min.z + bounds.max.z) / 2);
    const next = floorPoint(new THREE.Vector3(
        THREE.MathUtils.clamp(point.x, minX, maxX), 0,
        THREE.MathUtils.clamp(point.z, minZ, maxZ)
    ));
    if (!next) return false;
    piece.position.copy(next);
    return true;
}
function addPiece(type, point) {
    selected = pieceTemplates.get(type).model.clone();
    activeFloor.pieces.add(selected);
    if (position(selected, point, true) === false) {
        selected.parent.remove(selected);
        selected = null;
        updateControls(furniture[type].placement === 'surface'
            ? 'テレビはテレビボードの天板に配置してください。'
            : '家具は床のある場所に配置してください。');
        return;
    }
    armed = null;
    updateControls(furniture[type].name + 'を配置しました。ドラッグして位置を調整できます。');
}
for (const button of catalog) {
    const type = button.dataset.piece;
    let moved = false;
    let loadingModel = false;
    button.addEventListener('pointerdown', event => {
        if (!pieceTemplates.has(type)) return;
        if (event.button !== 0 || !result.hidden || gesture) return;
        moved = false;
        button.setPointerCapture(event.pointerId);
        gesture = { id: event.pointerId, type, x: event.clientX, y: event.clientY, draft: null };
    });
    button.addEventListener('pointermove', event => {
        if (gesture?.id !== event.pointerId) return;
        if (!moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6) return;
        moved = true;
        const point = pointAt(event);
        if (onFloor(point)) {
            if (!gesture.draft) {
                gesture.draft = pieceTemplates.get(type).model.clone();
                activeFloor.pieces.add(gesture.draft);
            }
            gesture.draft.visible = true;
            if (position(gesture.draft, point, true) === false) gesture.draft.visible = false;
        } else if (gesture.draft) gesture.draft.visible = false;
        draw();
    });
    button.addEventListener('pointerup', event => {
        if (gesture?.id !== event.pointerId) return;
        const draft = gesture.draft;
        gesture = null;
        if (draft) draft.parent.remove(draft);
        const point = pointAt(event);
        if (moved && onFloor(point)) addPiece(type, point);
        else draw();
    });
    button.addEventListener('pointercancel', () => {
        if (gesture?.draft) gesture.draft.parent.remove(gesture.draft);
        gesture = null;
        draw();
    });
    button.addEventListener('click', async event => {
        if (!result.hidden || loadingModel || (event.detail && moved)) return;
        loadingModel = true;
        button.disabled = true;
        status.textContent = furniture[type].name + 'を読み込んでいます…';
        try {
            await loadPiece(type);
        } catch (error) {
            console.error(error);
            status.textContent = 'モデルを読み込めませんでした。もう一度選択してください。';
            return;
        } finally {
            loadingModel = false;
            button.disabled = !!wallpaperDraft || !result.hidden;
        }
        if (!result.hidden || wallpaperDraft) return;
        armed = type;
        selected = null;
        updateControls(furniture[type].placement === 'surface'
            ? 'テレビボードの天板をタップしてテレビを配置してください。'
            : furniture[type].name + 'を置きたい場所をタップしてください。');
    });
}

const canvas = renderer.domElement;
const orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(cameraTarget));
let drag = null;
canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    if (previewRoom) {
        previewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (previewPointers.size === 2) {
            pinchDistance = previewPointerDistance();
            drag = null;
        } else {
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }
        canvas.setPointerCapture(event.pointerId);
        return;
    }
    if (drag || gesture) return;
    const point = pointAt(event);
    if (!point) return;
    if (!wallpaperDraft && armed && onFloor(point)) {
        addPiece(armed, point);
        return;
    }

    const hit = ray.intersectObjects(activeFloor.pieces.children, true)[0];
    selected = wallpaperDraft ? null : hit?.object ?? null;
    while (selected && !selected.userData.type) selected = selected.parent;
    drag = selected
        ? { id: event.pointerId, offset: selected.getWorldPosition(new THREE.Vector3()).sub(point) }
        : { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    updateControls(selected ? furniture[selected.userData.type].name + 'を選択しました。' : '空いている場所をドラッグすると視点を回転できます。');
});
function previewPointerDistance() {
    const [a, b] = [...previewPointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}
canvas.addEventListener('pointermove', event => {
    if (previewRoom && previewPointers.has(event.pointerId)) {
        previewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (previewPointers.size === 2) {
            const distance = previewPointerDistance();
            if (pinchDistance > 0) previewZoom = THREE.MathUtils.clamp(previewZoom * distance / pinchDistance, 0.5, 3);
            pinchDistance = distance;
            resize();
            return;
        }
    }
    if (drag?.id !== event.pointerId) return;
    if (drag.offset) {
        const point = pointAt(event);
        if (selected && point) position(selected, point.add(drag.offset), true);
    } else {
        orbit.theta -= (event.clientX - drag.x) * .008;
        orbit.phi = THREE.MathUtils.clamp(orbit.phi - (event.clientY - drag.y) * .008, .12, 1.25);
        drag.x = event.clientX;
        drag.y = event.clientY;
        camera.position.setFromSpherical(orbit).add(cameraTarget);
        camera.lookAt(cameraTarget);
    }
    draw();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => {
        if (previewRoom) {
            previewPointers.delete(event.pointerId);
            pinchDistance = 0;
            const remaining = [...previewPointers.entries()][0];
            drag = remaining ? { id: remaining[0], ...remaining[1] } : null;
            return;
        }
        if (drag?.id === event.pointerId) drag = null;
    });
}
canvas.addEventListener('wheel', event => {
    if (!previewRoom) return;
    event.preventDefault();
    previewZoom = THREE.MathUtils.clamp(previewZoom * Math.exp(-event.deltaY * 0.001), 0.5, 3);
    resize();
}, { passive: false });
rotate.addEventListener('click', () => {
    if (!selected) return;
    selected.rotation.y += Math.PI / 4;
    position(selected, selected.getWorldPosition(new THREE.Vector3()));
    draw();
});
remove.addEventListener('click', () => {
    if (!selected) return;
    selected.parent.remove(selected);
    selected = null;
    updateControls('家具を削除しました。');
});
floorSelect.addEventListener('change', async () => {
    if (gesture?.draft) gesture.draft.parent.remove(gesture.draft);
    gesture = null;
    drag = null;
    selected = null;
    armed = null;
    const previousIndex = floorEntries.findIndex(entry => entry.name === activeFloor.room.name);
    const controls = [...catalog, floorSelect, showWalls, wallColor, wallpaperButton, preview, rotate, remove];
    for (const control of controls) control.disabled = true;
    status.textContent = '階のモデルを読み込んでいます…';
    try {
        activateFloor(await loadFloor(Number(floorSelect.value)));
        orbit.setFromVector3(camera.position.clone().sub(cameraTarget));
        resize();
        updateControls(activeFloor.room.name + 'を選択しました。');
    } catch (error) {
        console.error(error);
        floorSelect.value = String(previousIndex);
        updateControls('階のモデルを読み込めませんでした。もう一度選択してください。');
    } finally {
        for (const control of [...catalog, floorSelect, showWalls, wallpaperButton, preview]) control.disabled = false;
        wallColor.disabled = !activeFloor.wallMaterials.size || Boolean(activeFloor.wallpaper.id);
    }
});
showWalls.addEventListener('change', () => {
    updateWallVisibility();
    resize();
});
wallColor.addEventListener('input', event => {
    if (activeFloor.wallpaper.id) return;
    activeFloor.plainWallColor = event.target.value;
    activeFloor.wallpaper.id = null;
    for (const material of activeFloor.wallMaterials) {
        material.map = null;
        material.color.set(event.target.value);
        material.needsUpdate = true;
    }
    activeFloor.wallpaperTexture?.dispose();
    activeFloor.wallpaperTexture = null;
    draw();
});

preview.addEventListener('click', async () => {
    if (gesture || drag) return;
    const editingControls = [...catalog, showWalls, wallColor, wallpaperButton, arScale, floorSelect, rotate, remove, preview];
    for (const control of editingControls) control.disabled = true;
    try {
        const exporter = new GLTFExporter();
        const completeRoom = activeFloor.room.clone();
        completeRoom.traverse(object => {
            object.visible = true;
            if (!object.isMesh) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            const restored = materials.map(material =>
                ['floor', 'internalWall'].includes(material.name)
                    ? material
                    : previewMaterials.get(material.uuid) ?? material
            );
            object.material = Array.isArray(object.material) ? restored : restored[0];
        });
        const percent = Number.parseInt(arScale.value, 10);
        const scale = percent === 100 ? 1 : percent / 200;
        const arRoom = completeRoom.clone();
        arRoom.scale.setScalar(scale);
        const arBuffer = await exporter.parseAsync(arRoom, { binary: true });
        previewRoom = activeFloor.room.clone();
        previewRoom.traverse(object => {
            object.visible = true;
            if (!object.isMesh) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            object.visible = !materials.some(material => material.name === 'roof');
            const copies = materials.map(material => material.clone());
            object.material = Array.isArray(object.material) ? copies : copies[0];
        });
        if (arUrl) URL.revokeObjectURL(arUrl);
        arUrl = URL.createObjectURL(new Blob([arBuffer], { type: 'model/gltf-binary' }));
        launchAR.disabled = true;
        arViewer.src = arUrl;
        selected = null;
        armed = null;
        drag = null;
        previewPointers.clear();
        previewZoom = 1;
        scene.remove(activeFloor.room);
        scene.add(previewRoom);
        result.hidden = false;
        resize();
        status.textContent = activeFloor.room.name + 'の配置を確認できます。ARでは、この階の床が実際の床と同じ高さになります。';
    } catch (error) {
        console.error(error);
        for (const control of [...catalog, showWalls, wallColor, wallpaperButton, arScale, floorSelect, preview]) control.disabled = false;
        wallColor.disabled = !activeFloor.wallMaterials.size || Boolean(activeFloor.wallpaper.id);
        updateControls('プレビューを作成できませんでした。');
    }
});
document.querySelector('#back').addEventListener('click', () => {
    if (previewRoom) {
        scene.remove(previewRoom);
        previewRoom.traverse(object => {
            if (!object.isMesh) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of materials) material.dispose();
        });
        previewRoom = null;
        scene.add(activeFloor.room);
    }
    previewPointers.clear();
    drag = null;
    result.hidden = true;
    resize();
    for (const control of [...catalog, showWalls, wallColor, wallpaperButton, arScale, floorSelect, preview]) control.disabled = false;
    wallColor.disabled = !activeFloor.wallMaterials.size || Boolean(activeFloor.wallpaper.id);
    updateControls('編集に戻りました。');
});
