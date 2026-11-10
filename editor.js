import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const rotate = document.querySelector('#rotate');
const remove = document.querySelector('#remove');
const catalog = [...document.querySelectorAll('[data-piece]')];
const preview = document.querySelector('#preview');
const result = document.querySelector('#result');
const viewer = document.querySelector('#viewer');
const download = document.querySelector('#download');
const arViewer = document.querySelector('#ar-viewer');
const arScale = document.querySelector('#ar-scale');
const launchAR = document.querySelector('#launch-ar');
let arUrl = null;
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
function box(parent, width, height, depth, x, y, z, color) {
    const material = typeof color === 'string' ? new THREE.MeshStandardMaterial({ color, roughness: 0.8 }) : color;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
}

const floorWidth = 8;
const floorDepth = 6;
const zones = [
    { name: 'リビング', x: -2, z: 0, width: 4, depth: 6, colors: ['#d2af86', '#b89b80'] },
    { name: 'キッチン', x: 2, z: -1.5, width: 4, depth: 3, colors: ['#c2c8bb', '#c9d1cf'] },
    { name: '寝室', x: 2, z: 1.5, width: 4, depth: 3, colors: ['#dbb8a5', '#d8bdac'] }
];

function createFloor(name, level, wallColor) {
    const room = new THREE.Group();
    room.name = name;
    const pieces = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.85 });
    room.add(pieces);
    for (const zone of zones) {
        const surface = new THREE.Mesh(
            new THREE.PlaneGeometry(zone.width, zone.depth),
            new THREE.MeshStandardMaterial({ color: zone.colors[level], roughness: 0.8 })
        );
        surface.name = zone.name;
        surface.rotation.x = -Math.PI / 2;
        surface.position.set(zone.x, 0, zone.z);
        room.add(surface);
    }

    box(room, floorWidth, 2.35, .12, 0, 1.175, -3.06, wall);
    box(room, .12, 2.35, floorDepth, -4.06, 1.175, 0, wall);

    // Each doorway leaves a one-meter gap in the central partition.
    for (const z of [-2.5, -0.5, 0.5, 2.5]) {
        box(room, .12, 2.35, 1, 0, 1.175, z, wall);
    }
    box(room, 4, 2.35, .12, 2, 1.175, 0, wall);
    return { room, pieces, wall };
}

const floors = [
    createFloor('1階', 0, '#e8ded0'),
    createFloor('2階', 1, '#e1e8ec')
];
const roomLabels = zones.map(zone => {
    const label = document.createElement('span');
    label.className = 'room-label';
    label.textContent = zone.name;
    stage.append(label);
    return { label, point: new THREE.Vector3(zone.x, 0.04, zone.z) };
});
const labelProjection = new THREE.Vector3();

const floorSelect = document.querySelector('#floor-select');
let activeFloor = floors[Number(floorSelect.value)];
scene.add(activeFloor.room);

const grid = new THREE.GridHelper(floorWidth, 16, 0x8c755e, 0xbaa58d);
grid.position.y = .002;
grid.scale.z = floorDepth / floorWidth;
scene.add(grid);

const furniture = {
    sofa: { name: 'ソファ', width: 2, depth: .9 },
    table: { name: 'テーブル', width: 1.3, depth: .8 },
    chair: { name: '椅子', width: .55, depth: .55 }
};
function makePiece(type) {
    const piece = new THREE.Group();
    piece.userData.type = type;
    if (type === 'sofa') {
        box(piece, 2, .34, .9, 0, .25, 0, '#476d65');
        box(piece, 2, .5, .18, 0, .58, -.36, '#476d65');
        for (const side of [-1, 1]) {
            box(piece, .17, .33, .9, side * .91, .48, 0, '#385950');
            box(piece, .79, .12, .68, side * .41, .45, .07, '#719184');
        }
    } else {
        const table = type === 'table';
        const { width, depth } = furniture[type];
        const height = table ? .75 : .46;
        const wood = table ? '#835b40' : '#304f75';
        box(piece, width, .08, depth, 0, height, 0, wood);
        for (const x of [-1, 1]) {
            for (const z of [-1, 1]) {
                box(piece, .07, height, .07, x * (width / 2 - .06), height / 2, z * (depth / 2 - .06), wood);
            }
        }
        if (!table) box(piece, .55, .43, .08, 0, .68, -.235, wood);
    }
    return piece;
}

const pieceTemplates = new Map();
const centimeters = meters => Math.round(meters * 1000) / 10;
for (const button of catalog) {
    const type = button.dataset.piece;
    const model = makePiece(type);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const dimensions = [size.x, size.z, size.y].map(centimeters).join(' × ');
    pieceTemplates.set(type, { model, top: bounds.max.y, dimensions });
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
let modelUrl = null;
const selection = new THREE.BoxHelper(new THREE.Object3D(), 0x245e9b);
selection.visible = false;
scene.add(selection);

function draw() {
    selection.visible = !!selected;
    if (selected) selection.setFromObject(selected);
    renderer.render(scene, camera);
    for (const { label, point } of roomLabels) {
        labelProjection.copy(point).project(camera);
        label.style.left = (labelProjection.x + 1) * 50 + '%';
        label.style.top = (1 - labelProjection.y) * 50 + '%';
    }
    sizeFlag.hidden = !selected;
    if (!selected || !stage.clientWidth) return;

    const type = selected.userData.type;
    const { top, dimensions } = pieceTemplates.get(type);
    if (flaggedType !== type) {
        sizeFlag.textContent = furniture[type].name + ' · ' + dimensions + ' cm';
        flaggedType = type;
    }
    flagPosition.copy(selected.position);
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
    const aspect = width / height;
    const half = Math.max(4.6, 5.4 / aspect);
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    draw();
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
function onFloor(point) {
    return point && Math.abs(point.x) <= floorWidth / 2 && Math.abs(point.z) <= floorDepth / 2;
}
function position(piece, point) {
    const { width, depth } = furniture[piece.userData.type];
    const c = Math.abs(Math.cos(piece.rotation.y));
    const s = Math.abs(Math.sin(piece.rotation.y));
    const x = (c * width + s * depth) / 2;
    const z = (s * width + c * depth) / 2;
    const xLimit = floorWidth / 2 - x;
    const zLimit = floorDepth / 2 - z;
    piece.position.set(THREE.MathUtils.clamp(point.x, -xLimit, xLimit), 0, THREE.MathUtils.clamp(point.z, -zLimit, zLimit));
}
function addPiece(type, point) {
    selected = pieceTemplates.get(type).model.clone();
    activeFloor.pieces.add(selected);
    position(selected, point);
    armed = null;
    updateControls(furniture[type].name + 'を配置しました。ドラッグして位置を調整できます。');
}
for (const button of catalog) {
    const type = button.dataset.piece;
    let moved = false;
    button.addEventListener('pointerdown', event => {
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
            position(gesture.draft, point);
        } else if (gesture.draft) gesture.draft.visible = false;
        draw();
    });
    button.addEventListener('pointerup', event => {
        if (gesture?.id !== event.pointerId) return;
        const draft = gesture.draft;
        gesture = null;
        if (draft) activeFloor.pieces.remove(draft);
        const point = pointAt(event);
        if (moved && onFloor(point)) addPiece(type, point);
        else draw();
    });
    button.addEventListener('pointercancel', () => {
        if (gesture?.draft) activeFloor.pieces.remove(gesture.draft);
        gesture = null;
        draw();
    });
    button.addEventListener('click', event => {
        if (!result.hidden || (event.detail && moved)) return;
        armed = type;
        selected = null;
        updateControls(furniture[type].name + 'を置きたい場所をタップしてください。');
    });
}

const canvas = renderer.domElement;
const orbit = new THREE.Spherical().setFromVector3(camera.position);
let drag = null;
canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag || gesture) return;
    const point = pointAt(event);
    if (!point) return;
    if (armed && onFloor(point)) {
        addPiece(armed, point);
        return;
    }

    const hit = ray.intersectObjects(activeFloor.pieces.children, true)[0];
    selected = hit?.object.parent ?? null;
    drag = selected
        ? { id: event.pointerId, offset: selected.position.clone().sub(point) }
        : { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    updateControls(selected ? furniture[selected.userData.type].name + 'を選択しました。' : '空いている場所をドラッグすると視点を回転できます。');
});
canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    if (drag.offset) {
        const point = pointAt(event);
        if (selected && point) position(selected, point.add(drag.offset));
    } else {
        orbit.theta -= (event.clientX - drag.x) * .008;
        orbit.phi = THREE.MathUtils.clamp(orbit.phi - (event.clientY - drag.y) * .008, .12, 1.25);
        drag.x = event.clientX;
        drag.y = event.clientY;
        camera.position.setFromSpherical(orbit);
        camera.lookAt(0, 0, 0);
    }
    draw();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => {
        if (drag?.id === event.pointerId) drag = null;
    });
}
rotate.addEventListener('click', () => {
    if (!selected) return;
    selected.rotation.y += Math.PI / 4;
    position(selected, selected.position);
    draw();
});
remove.addEventListener('click', () => {
    if (!selected) return;
    activeFloor.pieces.remove(selected);
    selected = null;
    updateControls('家具を削除しました。');
});
const wallColor = document.querySelector('#wall-color');
wallColor.value = '#' + activeFloor.wall.color.getHexString();
floorSelect.addEventListener('change', () => {
    if (gesture?.draft) activeFloor.pieces.remove(gesture.draft);
    gesture = null;
    drag = null;
    selected = null;
    armed = null;
    scene.remove(activeFloor.room);
    activeFloor = floors[Number(floorSelect.value)];
    scene.add(activeFloor.room);
    wallColor.value = '#' + activeFloor.wall.color.getHexString();
    updateControls(activeFloor.room.name + 'を選択しました。');
});
wallColor.addEventListener('input', event => {
    activeFloor.wall.color.set(event.target.value);
    draw();
});

preview.addEventListener('click', async () => {
    if (gesture || drag) return;
    const editingControls = [...catalog, wallColor, arScale, floorSelect, rotate, remove, preview];
    for (const control of editingControls) control.disabled = true;
    try {
        const exporter = new GLTFExporter();
        const buffer = await exporter.parseAsync(activeFloor.room, { binary: true });
        const percent = Number.parseInt(arScale.value, 10);
        const scale = percent === 100 ? 1 : percent / 200;
        const arRoom = activeFloor.room.clone();
        arRoom.scale.setScalar(scale);
        const arBuffer = scale === 1 ? buffer : await exporter.parseAsync(arRoom, { binary: true });
        if (arUrl) URL.revokeObjectURL(arUrl);
        arUrl = URL.createObjectURL(new Blob([arBuffer], { type: 'model/gltf-binary' }));
        launchAR.disabled = true;
        arViewer.src = arUrl;
        if (modelUrl) URL.revokeObjectURL(modelUrl);
        modelUrl = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
        viewer.src = modelUrl;
        download.href = modelUrl;
        stage.hidden = true;
        result.hidden = false;
        status.textContent = activeFloor.room.name + 'の配置を確認できます。ARでは、この階の床が実際の床と同じ高さになります。';
    } catch (error) {
        console.error(error);
        for (const control of [...catalog, wallColor, arScale, floorSelect, preview]) control.disabled = false;
        updateControls('プレビューを作成できませんでした。');
    }
});
document.querySelector('#back').addEventListener('click', () => {
    result.hidden = true;
    stage.hidden = false;
    for (const control of [...catalog, wallColor, arScale, floorSelect, preview]) control.disabled = false;
    updateControls('編集に戻りました。');
});
